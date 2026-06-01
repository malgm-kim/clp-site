'use client';

import { useState } from 'react';

const CONTAINER_TYPES = [
  {
    name: '20GP',
    length: 589,
    width: 235,
    height: 239,
    maxCbm: 33.2,
    maxWeight: 21700,
  },
  {
    name: '40GP',
    length: 1200,
    width: 235,
    height: 239,
    maxCbm: 67.7,
    maxWeight: 26680,
  },
  {
    name: '40HQ',
    length: 1200,
    width: 235,
    height: 269,
    maxCbm: 76.4,
    maxWeight: 26680,
  },
];

type CargoItem = {
  id: number;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity: number;
  noStack: boolean;
};

type PlacedBox = {
  cargoId: number;
  cargoName: string;
  color: string;
  weight: number;
  height: number;
  width: number;
  length: number;
  layer: number;
};

type Cell = {
  cellId: number;
  x: number;
  y: number;
  cellLength: number;
  cellWidth: number;
  boxes: PlacedBox[];
  usedHeight: number;
  noStack: boolean;
};

type ContainerLoad = { containerId: number; cells: Cell[]; usedLength: number };
type FreeRect = { x: number; y: number; w: number; h: number };

const COLORS = [
  '#4f8ef7',
  '#38a169',
  '#e07b30',
  '#6a5acd',
  '#e04040',
  '#0891b2',
  '#d97706',
  '#7c3aed',
];

function calcLoadAbove(boxes: PlacedBox[], layerIdx: number): number {
  return boxes.slice(layerIdx + 1).reduce((sum, b) => sum + b.weight, 0);
}

// ✅ 허용하중 = 맨 아래 박스(1단)의 자체 중량
function canStackOn(cell: Cell, newBox: { weight: number }): boolean {
  if (cell.boxes.length === 0) return true;
  const bottomBox = cell.boxes[0]; // 1단 박스
  const currentLoadAbove = calcLoadAbove(cell.boxes, 0); // 현재 1단 위 하중
  return currentLoadAbove + newBox.weight <= bottomBox.weight;
}

function maxRectsBSSF(
  freeRects: FreeRect[],
  boxW: number,
  boxH: number
): { rect: FreeRect; rotated: boolean } | null {
  let best: { rect: FreeRect; rotated: boolean; score: number } | null = null;
  for (const rect of freeRects) {
    const tryFit = (bw: number, bh: number, rotated: boolean) => {
      if (bw > rect.w || bh > rect.h) return;
      const score = Math.min(rect.w - bw, rect.h - bh);
      if (!best || score < best.score) best = { rect, rotated, score };
    };
    tryFit(boxW, boxH, false);
    if (boxW !== boxH) tryFit(boxH, boxW, true);
  }
  return best;
}

function splitMaxRects(
  freeRects: FreeRect[],
  px: number,
  py: number,
  pw: number,
  ph: number
): FreeRect[] {
  const result: FreeRect[] = [];
  for (const rect of freeRects) {
    if (
      px >= rect.x + rect.w ||
      px + pw <= rect.x ||
      py >= rect.y + rect.h ||
      py + ph <= rect.y
    ) {
      result.push(rect);
      continue;
    }
    if (py > rect.y)
      result.push({ x: rect.x, y: rect.y, w: rect.w, h: py - rect.y });
    if (py + ph < rect.y + rect.h)
      result.push({
        x: rect.x,
        y: py + ph,
        w: rect.w,
        h: rect.y + rect.h - (py + ph),
      });
    if (px > rect.x) result.push({ x: rect.x, y: py, w: px - rect.x, h: ph });
    if (px + pw < rect.x + rect.w)
      result.push({ x: px + pw, y: py, w: rect.x + rect.w - (px + pw), h: ph });
  }
  return result.filter(
    (r, i) =>
      !result.some(
        (o, j) =>
          i !== j &&
          o.x <= r.x &&
          o.y <= r.y &&
          o.x + o.w >= r.x + r.w &&
          o.y + o.h >= r.y + r.h
      )
  );
}

type ActiveContainer = ContainerLoad & { freeRects: FreeRect[] };

function runPacking(
  allBoxes: CargoItem[],
  cargos: CargoItem[],
  cL: number,
  cW: number,
  cH: number
): ContainerLoad[] {
  const loads: ContainerLoad[] = [];
  let containerId = 0,
    cellId = 0;
  const newContainer = (): ActiveContainer => ({
    containerId: containerId++,
    cells: [],
    usedLength: 0,
    freeRects: [{ x: 0, y: 0, w: cL, h: cW }],
  });
  let current = newContainer();
  loads.push(current);

  for (const cargo of allBoxes) {
    if (cargo.height > cH) continue;
    const colorIdx = cargos.findIndex((c) => c.id === cargo.id);
    const color = COLORS[colorIdx % COLORS.length];
    const box: PlacedBox = {
      cargoId: cargo.id,
      cargoName: cargo.name,
      color,
      weight: cargo.weight,
      height: cargo.height,
      width: cargo.width,
      length: cargo.length,
      layer: 0,
    };

    let placed = false;

    if (!cargo.noStack) {
      for (const cell of current.cells) {
        if (cell.noStack) continue;
        if (
          cell.cellLength >= cargo.length &&
          cell.cellWidth >= cargo.width &&
          cell.usedHeight + cargo.height <= cH &&
          canStackOn(cell, box) // ✅ 하중 체크
        ) {
          cell.boxes.push({ ...box, layer: cell.boxes.length + 1 });
          cell.usedHeight += cargo.height;
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      const tryPlace = (container: ActiveContainer): boolean => {
        const fit = maxRectsBSSF(
          container.freeRects,
          cargo.length,
          cargo.width
        );
        if (!fit) return false;
        const fl = fit.rotated ? cargo.width : cargo.length;
        const fw = fit.rotated ? cargo.length : cargo.width;
        container.cells.push({
          cellId: cellId++,
          x: fit.rect.x,
          y: fit.rect.y,
          cellLength: fl,
          cellWidth: fw,
          boxes: [{ ...box, length: fl, width: fw, layer: 1 }],
          usedHeight: cargo.height,
          noStack: cargo.noStack,
        });
        container.freeRects = splitMaxRects(
          container.freeRects,
          fit.rect.x,
          fit.rect.y,
          fl,
          fw
        );
        return true;
      };
      if (!tryPlace(current)) {
        current = newContainer();
        loads.push(current);
        tryPlace(current);
      }
    }
  }

  for (const load of loads) {
    load.usedLength =
      load.cells.length > 0
        ? Math.max(...load.cells.map((c) => c.x + c.cellLength))
        : 0;
  }
  return loads;
}

function buildContainerLoads(
  cargos: CargoItem[],
  cL: number,
  cW: number,
  cH: number
): ContainerLoad[] {
  const baseBoxes = [...cargos].flatMap((c) =>
    Array.from({ length: c.quantity }, () => ({ ...c }))
  );
  const strategies = [
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return Math.max(z.length, z.width) - Math.max(a.length, a.width);
      }),
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return z.length * z.width * z.height - a.length * a.width * a.height;
      }),
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return z.length * z.width - a.length * a.width;
      }),
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return z.weight - a.weight;
      }),
  ];
  let best: ContainerLoad[] | null = null;
  for (const s of strategies) {
    const result = runPacking(s(baseBoxes), cargos, cL, cW, cH);
    if (!best || result.length < best.length) best = result;
  }
  return best!;
}

function calcCenterOfGravity(
  cells: Cell[],
  containerLength: number,
  containerWidth: number
) {
  let totalWeight = 0,
    weightedX = 0,
    weightedY = 0;
  for (const cell of cells) {
    const cellWeight = cell.boxes.reduce((s, b) => s + b.weight, 0);
    weightedX += (cell.x + cell.cellLength / 2) * cellWeight;
    weightedY += (cell.y + cell.cellWidth / 2) * cellWeight;
    totalWeight += cellWeight;
  }
  if (totalWeight === 0) return { x: 0.5, y: 0.5, totalWeight: 0 };
  return {
    x: weightedX / totalWeight / containerLength,
    y: weightedY / totalWeight / containerWidth,
    totalWeight,
  };
}

export default function Home() {
  const [selectedContainer, setSelectedContainer] = useState(
    CONTAINER_TYPES[1]
  );
  const [cargos, setCargos] = useState<CargoItem[]>([
    {
      id: 1,
      name: '',
      length: 0,
      width: 0,
      height: 0,
      weight: 0,
      quantity: 1,
      noStack: false,
    },
  ]);
  const [page, setPage] = useState<'input' | 'result'>('input');
  const [containerLoads, setContainerLoads] = useState<ContainerLoad[]>([]);
  const [hoveredCell, setHoveredCell] = useState<Cell | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const addCargo = () =>
    setCargos([
      ...cargos,
      {
        id: Date.now(),
        name: '',
        length: 0,
        width: 0,
        height: 0,
        weight: 0,
        quantity: 1,
        noStack: false,
      },
    ]);
  const removeCargo = (id: number) =>
    setCargos(cargos.filter((c) => c.id !== id));
  const updateCargo = (id: number, field: keyof CargoItem, value: any) =>
    setCargos(cargos.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  const calcCbm = (c: CargoItem) =>
    (c.length / 100) * (c.width / 100) * (c.height / 100) * c.quantity;
  const totalCbm = cargos.reduce((sum, c) => sum + calcCbm(c), 0);
  const totalWeight = cargos.reduce((sum, c) => sum + c.weight * c.quantity, 0);
  const loadRate = ((totalCbm / selectedContainer.maxCbm) * 100).toFixed(1);

  const calculate = () => {
    const loads = buildContainerLoads(
      cargos,
      selectedContainer.length,
      selectedContainer.width,
      selectedContainer.height
    );
    setContainerLoads(loads);
    setPage('result');
  };

  const StackTooltip = ({ cell }: { cell: Cell }) => {
    const boxW = 180;
    return (
      <div
        style={{
          position: 'fixed',
          left: tooltipPos.x + 16,
          top: Math.min(tooltipPos.y - 20, window.innerHeight - 400),
          background: 'white',
          border: '2px solid #4f8ef7',
          borderRadius: 12,
          padding: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          zIndex: 1000,
          minWidth: 240,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: '#4f8ef7',
            marginBottom: 10,
          }}
        >
          📦 정면 스택 뷰 + 하중
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          {[...cell.boxes].reverse().map((box, ri) => {
            const layerIdx = cell.boxes.length - 1 - ri;
            const loadAbove = calcLoadAbove(cell.boxes, layerIdx);
            const bottomBox = cell.boxes[0];
            const allowedLoad = bottomBox.weight; // 허용하중 = 1단 박스 중량
            const isOverload = layerIdx === 0 && loadAbove > allowedLoad;

            return (
              <div
                key={ri}
                style={{
                  width: boxW,
                  minHeight: 56,
                  background: isOverload ? '#e04040' : box.color,
                  borderRadius: 6,
                  padding: '6px 10px',
                  position: 'relative',
                  border: isOverload
                    ? '2px solid #ff4444'
                    : '2px solid transparent',
                }}
              >
                {cell.noStack && layerIdx === 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 3,
                      right: 4,
                      background: '#fff0f0',
                      color: '#e04040',
                      fontSize: 7,
                      padding: '1px 4px',
                      borderRadius: 3,
                      fontWeight: 800,
                    }}
                  >
                    NO STACK
                  </div>
                )}
                {isOverload && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: 4,
                      background: '#fff0f0',
                      color: '#e04040',
                      fontSize: 7,
                      padding: '1px 4px',
                      borderRadius: 3,
                      fontWeight: 800,
                    }}
                  >
                    ⚠️ 하중초과
                  </div>
                )}
                <div style={{ color: 'white', fontSize: 10, fontWeight: 700 }}>
                  {box.layer}단 · {box.cargoName || '화물'}
                </div>
                <div
                  style={{
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: 9,
                    marginTop: 2,
                  }}
                >
                  자체 중량: {box.weight}kg
                </div>
                {loadAbove > 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 9 }}>
                    위 하중: +{loadAbove}kg &nbsp;→&nbsp; 합계{' '}
                    {box.weight + loadAbove}kg
                  </div>
                )}
                {layerIdx === 0 && (
                  <div
                    style={{
                      color: isOverload ? '#ffcccc' : 'rgba(255,255,255,0.75)',
                      fontSize: 9,
                    }}
                  >
                    허용 하중: {allowedLoad}kg {isOverload ? '❌ 초과!' : '✅'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div
          style={{
            width: boxW + 20,
            height: 8,
            background: '#888',
            borderRadius: 4,
            margin: '0 auto',
          }}
        />
        <div
          style={{
            fontSize: 10,
            color: '#aaa',
            textAlign: 'center',
            marginTop: 4,
          }}
        >
          컨테이너 바닥
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: '#666',
            borderTop: '1px solid #eee',
            paddingTop: 8,
          }}
        >
          <div>
            사용 높이: <strong>{cell.usedHeight}cm</strong> /{' '}
            {selectedContainer.height}cm
          </div>
          <div>
            총 적재 중량:{' '}
            <strong>{cell.boxes.reduce((s, b) => s + b.weight, 0)}kg</strong>
          </div>
          <div style={{ marginTop: 4, fontSize: 10, color: '#aaa' }}>
            💡 허용하중 = 1단 박스 자체 중량
          </div>
        </div>
      </div>
    );
  };

  if (page === 'result') {
    const totalContainers = containerLoads.length;
    const weightRate = (
      (totalWeight / (selectedContainer.maxWeight * totalContainers)) *
      100
    ).toFixed(1);
    const cargoColors = cargos.map((c, i) => ({
      ...c,
      color: COLORS[i % COLORS.length],
    }));
    const DISPLAY_LENGTH = 660;
    const DISPLAY_WIDTH = 180;

    return (
      <main
        style={{
          fontFamily: 'sans-serif',
          maxWidth: 960,
          margin: '0 auto',
          padding: 24,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
          📊 적재 계산 결과
        </h1>
        <p style={{ color: '#888', marginBottom: 24 }}>
          {selectedContainer.name} 컨테이너 기준
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 16,
            marginBottom: 24,
          }}
        >
          {[
            {
              label: '필요 컨테이너',
              value: `${totalContainers}개`,
              color: '#1a1a2e',
              sub: `${selectedContainer.name} 기준`,
            },
            {
              label: '총 CBM',
              value: `${totalCbm.toFixed(2)}`,
              color: '#4f8ef7',
              sub: `컨테이너당 ${selectedContainer.maxCbm} CBM`,
            },
            {
              label: '중량 사용률',
              value: `${weightRate}%`,
              color: Number(weightRate) > 100 ? '#e04040' : '#e07b30',
              sub: `총 ${totalWeight.toLocaleString()} kg`,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: '#888',
                  fontWeight: 600,
                  marginBottom: 8,
                  textTransform: 'uppercase',
                }}
              >
                {stat.label}
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: stat.color }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                {stat.sub}
              </div>
            </div>
          ))}
        </div>

        {containerLoads.map((load, ci) => {
          const colLoadRate = (
            (load.usedLength / selectedContainer.length) *
            100
          ).toFixed(1);
          const scaleL = DISPLAY_LENGTH / selectedContainer.length;
          const scaleW = DISPLAY_WIDTH / selectedContainer.width;
          const cog = calcCenterOfGravity(
            load.cells,
            selectedContainer.length,
            selectedContainer.width
          );
          const xPct = (cog.x * 100).toFixed(1);
          const yPct = (cog.y * 100).toFixed(1);
          const xImbalance = Math.abs(cog.x - 0.5) > 0.1;
          const yImbalance = Math.abs(cog.y - 0.5) > 0.1;

          return (
            <div
              key={load.containerId}
              style={{
                background: 'white',
                borderRadius: 12,
                padding: 20,
                marginBottom: 20,
                boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#555',
                    textTransform: 'uppercase',
                  }}
                >
                  🚢 컨테이너 {ci + 1} / {totalContainers}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    fontSize: 12,
                    color: '#666',
                  }}
                >
                  <span>
                    사용 길이:{' '}
                    <strong style={{ color: '#4f8ef7' }}>
                      {load.usedLength}cm
                    </strong>{' '}
                    / {selectedContainer.length}cm
                  </span>
                  <span>
                    사용률:{' '}
                    <strong
                      style={{
                        color: Number(colLoadRate) > 90 ? '#38a169' : '#e07b30',
                      }}
                    >
                      {colLoadRate}%
                    </strong>
                  </span>
                </div>
              </div>
              <div
                style={{
                  background: '#f0f0f0',
                  borderRadius: 4,
                  height: 6,
                  marginBottom: 16,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Number(colLoadRate))}%`,
                    height: '100%',
                    background:
                      Number(colLoadRate) > 90 ? '#38a169' : '#4f8ef7',
                    borderRadius: 4,
                  }}
                />
              </div>

              {/* 무게 중심 패널 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    background: '#f7f9fc',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#555',
                      marginBottom: 8,
                    }}
                  >
                    ⚖️ 무게 중심
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      paddingBottom: '50%',
                      background: '#e8f0fe',
                      borderRadius: 6,
                      border: '1px solid #c5d5f5',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: 0,
                        right: 0,
                        height: 1,
                        background: '#aac',
                        opacity: 0.5,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: 0,
                        bottom: 0,
                        width: 1,
                        background: '#aac',
                        opacity: 0.5,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: `${cog.x * 100}%`,
                        top: `${cog.y * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background:
                          xImbalance || yImbalance ? '#e04040' : '#38a169',
                        border: '2px solid white',
                        boxShadow: '0 0 4px rgba(0,0,0,0.3)',
                      }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    background: '#f7f9fc',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#555',
                      marginBottom: 8,
                    }}
                  >
                    ↔ 전후 분포 (길이)
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 4,
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 10, color: '#888', minWidth: 24 }}>
                      앞
                    </span>
                    <div
                      style={{
                        flex: 1,
                        background: '#e0e0e0',
                        borderRadius: 4,
                        height: 14,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${xPct}%`,
                          height: '100%',
                          background: xImbalance ? '#e04040' : '#4f8ef7',
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        color: '#888',
                        minWidth: 24,
                        textAlign: 'right',
                      }}
                    >
                      뒤
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      textAlign: 'center',
                      color: xImbalance ? '#e04040' : '#333',
                      fontWeight: 700,
                    }}
                  >
                    {xPct}% / {(100 - Number(xPct)).toFixed(1)}%{' '}
                    {xImbalance && '⚠️'}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: '#aaa',
                      textAlign: 'center',
                      marginTop: 2,
                    }}
                  >
                    이상: 50% / 50%
                  </div>
                </div>

                <div
                  style={{
                    background: '#f7f9fc',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#555',
                      marginBottom: 8,
                    }}
                  >
                    ↕ 좌우 분포 (폭)
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 4,
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 10, color: '#888', minWidth: 24 }}>
                      좌
                    </span>
                    <div
                      style={{
                        flex: 1,
                        background: '#e0e0e0',
                        borderRadius: 4,
                        height: 14,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${yPct}%`,
                          height: '100%',
                          background: yImbalance ? '#e04040' : '#38a169',
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        color: '#888',
                        minWidth: 24,
                        textAlign: 'right',
                      }}
                    >
                      우
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      textAlign: 'center',
                      color: yImbalance ? '#e04040' : '#333',
                      fontWeight: 700,
                    }}
                  >
                    {yPct}% / {(100 - Number(yPct)).toFixed(1)}%{' '}
                    {yImbalance && '⚠️'}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: '#aaa',
                      textAlign: 'center',
                      marginTop: 2,
                    }}
                  >
                    이상: 50% / 50%
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                ↔ 길이 방향 &nbsp; ↕ 폭 방향 &nbsp; 💡 셀에 마우스를 올리면 스택
                + 하중 뷰가 나타납니다
              </div>

              <div
                style={{
                  position: 'relative',
                  width: DISPLAY_LENGTH + 4,
                  height: DISPLAY_WIDTH + 4,
                  background: '#eef4ff',
                  border: '3px solid #4f8ef7',
                  borderRadius: 8,
                  overflow: 'hidden',
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 8,
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#4f8ef7',
                    zIndex: 2,
                  }}
                >
                  {selectedContainer.name} #{ci + 1}
                </div>
                <div
                  style={{
                    position: 'absolute',
                    top: `${cog.y * 100}%`,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: '#e04040',
                    opacity: 0.4,
                    zIndex: 3,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: `${cog.x * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: '#e04040',
                    opacity: 0.4,
                    zIndex: 3,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: `${cog.x * 100}%`,
                    top: `${cog.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    zIndex: 4,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background:
                      xImbalance || yImbalance ? '#e04040' : '#38a169',
                    border: '2px solid white',
                    boxShadow: '0 0 6px rgba(0,0,0,0.4)',
                  }}
                />

                {load.cells.map((cell) => {
                  const isHovered = hoveredCell?.cellId === cell.cellId;
                  const px = cell.x * scaleL,
                    py = cell.y * scaleW;
                  const pw = cell.cellLength * scaleL,
                    ph = cell.cellWidth * scaleW;
                  const bottomBox = cell.boxes[0];
                  const loadAboveBottom = calcLoadAbove(cell.boxes, 0);
                  const hasOverload =
                    cell.boxes.length > 1 &&
                    bottomBox &&
                    loadAboveBottom > bottomBox.weight;

                  return (
                    <div
                      key={cell.cellId}
                      onMouseEnter={(e) => {
                        setHoveredCell(cell);
                        setTooltipPos({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) =>
                        setTooltipPos({ x: e.clientX, y: e.clientY })
                      }
                      onMouseLeave={() => setHoveredCell(null)}
                      style={{
                        position: 'absolute',
                        left: px,
                        top: py,
                        width: pw,
                        height: ph,
                        display: 'flex',
                        flexDirection: 'row',
                        overflow: 'hidden',
                        borderRadius: 3,
                        cursor: 'pointer',
                        border: hasOverload
                          ? '2px solid #ff0000'
                          : isHovered
                          ? '2px solid white'
                          : '1px solid rgba(255,255,255,0.3)',
                        boxShadow: isHovered
                          ? '0 0 0 2px #1a1a2e'
                          : hasOverload
                          ? '0 0 0 2px #e04040'
                          : 'none',
                        zIndex: isHovered ? 10 : 1,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {cell.boxes.map((box, i) => (
                        <div
                          key={i}
                          style={{
                            flex: 1,
                            background: box.color,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: 7,
                            fontWeight: 700,
                            textAlign: 'center',
                            borderRight:
                              i < cell.boxes.length - 1
                                ? '1px solid rgba(255,255,255,0.4)'
                                : 'none',
                            overflow: 'hidden',
                            padding: 1,
                          }}
                        >
                          {pw > 28 && (
                            <div
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                              }}
                            >
                              {box.cargoName || '화물'}
                            </div>
                          )}
                          {ph > 18 && pw > 28 && (
                            <div style={{ fontSize: 6, opacity: 0.8 }}>
                              {box.layer}단
                            </div>
                          )}
                        </div>
                      ))}
                      {cell.noStack && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 2,
                            right: 2,
                            background: '#fff0f0',
                            color: '#e04040',
                            fontSize: 6,
                            padding: '1px 3px',
                            borderRadius: 2,
                            fontWeight: 800,
                          }}
                        >
                          NO
                        </div>
                      )}
                      {hasOverload && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 2,
                            left: 2,
                            background: '#e04040',
                            color: 'white',
                            fontSize: 6,
                            padding: '1px 3px',
                            borderRadius: 2,
                            fontWeight: 800,
                          }}
                        >
                          ⚠️
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: '#aaa',
                  paddingLeft: 2,
                  paddingRight: 2,
                }}
              >
                <span>← 0cm</span>
                <span>{selectedContainer.length}cm (길이) →</span>
              </div>
            </div>
          );
        })}

        <div
          style={{
            background: 'white',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#555',
              marginBottom: 10,
            }}
          >
            범례
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {cargoColors.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: '#555',
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: c.color,
                  }}
                />
                {c.name || '(미입력)'}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            background: 'white',
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#555',
              marginBottom: 12,
              textTransform: 'uppercase',
            }}
          >
            품목별 요약
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: '#f7f9fc' }}>
                  {[
                    '품명',
                    '수량',
                    '단위CBM',
                    '총CBM',
                    '중량(kg)',
                    '다단적재',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px',
                        textAlign: 'left',
                        color: '#666',
                        fontWeight: 600,
                        borderBottom: '2px solid #eee',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cargos.map((c, i) => (
                  <tr key={c.id}>
                    <td style={{ padding: '10px', fontWeight: 600 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: COLORS[i % COLORS.length],
                          marginRight: 6,
                        }}
                      />
                      {c.name || '(미입력)'}
                    </td>
                    <td style={{ padding: '10px' }}>{c.quantity}박스</td>
                    <td style={{ padding: '10px' }}>
                      {(
                        (c.length / 100) *
                        (c.width / 100) *
                        (c.height / 100)
                      ).toFixed(3)}
                    </td>
                    <td
                      style={{
                        padding: '10px',
                        color: '#4f8ef7',
                        fontWeight: 700,
                      }}
                    >
                      {calcCbm(c).toFixed(3)}
                    </td>
                    <td style={{ padding: '10px' }}>{c.weight}kg</td>
                    <td style={{ padding: '10px' }}>
                      <span
                        style={{
                          padding: '3px 10px',
                          borderRadius: 20,
                          fontSize: 11,
                          fontWeight: 700,
                          background: c.noStack ? '#fff0f0' : '#f0fff4',
                          color: c.noStack ? '#e04040' : '#38a169',
                        }}
                      >
                        {c.noStack ? '❌ 불가' : '✅ 가능'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => setPage('input')}
            style={{
              padding: '12px 28px',
              borderRadius: 8,
              border: '2px solid #4f8ef7',
              background: 'white',
              color: '#4f8ef7',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ← 다시 입력
          </button>
          <button
            style={{
              flex: 1,
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              background: '#ccc',
              color: 'white',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'not-allowed',
            }}
          >
            📄 PDF 저장 (다음 단계)
          </button>
        </div>

        {hoveredCell && <StackTooltip cell={hoveredCell} />}
      </main>
    );
  }

  return (
    <main
      style={{
        fontFamily: 'sans-serif',
        maxWidth: 960,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
        🚢 Container Load Plan
      </h1>
      <p style={{ color: '#888', marginBottom: 24 }}>
        화물 정보를 입력하면 적재율을 자동으로 계산해드립니다.
      </p>

      <section
        style={{
          background: 'white',
          borderRadius: 12,
          padding: 20,
          marginBottom: 20,
          boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        }}
      >
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#555',
            marginBottom: 12,
            textTransform: 'uppercase',
          }}
        >
          ① 컨테이너 타입
        </h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {CONTAINER_TYPES.map((ct) => (
            <button
              key={ct.name}
              onClick={() => setSelectedContainer(ct)}
              style={{
                padding: '10px 22px',
                borderRadius: 8,
                border: '2px solid',
                borderColor:
                  selectedContainer.name === ct.name ? '#4f8ef7' : '#ddd',
                background:
                  selectedContainer.name === ct.name ? '#eef4ff' : 'white',
                color: selectedContainer.name === ct.name ? '#4f8ef7' : '#444',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {ct.name}
            </button>
          ))}
        </div>
        <div
          style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}
        >
          {[
            { label: '내부 길이', value: `${selectedContainer.length}cm` },
            { label: '내부 폭', value: `${selectedContainer.width}cm` },
            { label: '내부 높이', value: `${selectedContainer.height}cm` },
            {
              label: '최대 중량',
              value: `${selectedContainer.maxWeight.toLocaleString()}kg`,
            },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: '#f7f9fc',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 13,
              }}
            >
              <span style={{ color: '#888' }}>{item.label}: </span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section
        style={{
          background: 'white',
          borderRadius: 12,
          padding: 20,
          marginBottom: 20,
          boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        }}
      >
        <h2
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#555',
            marginBottom: 12,
            textTransform: 'uppercase',
          }}
        >
          ② 화물 품목 입력
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          >
            <thead>
              <tr style={{ background: '#f7f9fc' }}>
                {[
                  '품명',
                  '길이(cm)',
                  '폭(cm)',
                  '높이(cm)',
                  '중량(kg)',
                  '수량',
                  'CBM',
                  '다단불가',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px',
                      textAlign: 'left',
                      color: '#666',
                      fontWeight: 600,
                      borderBottom: '2px solid #eee',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cargos.map((c) => (
                <tr key={c.id}>
                  <td style={{ padding: '8px 10px' }}>
                    <input
                      value={c.name}
                      onChange={(e) =>
                        updateCargo(c.id, 'name', e.target.value)
                      }
                      placeholder="품명"
                      style={inputStyle}
                    />
                  </td>
                  {(
                    ['length', 'width', 'height', 'weight', 'quantity'] as const
                  ).map((field) => (
                    <td key={field} style={{ padding: '8px 10px' }}>
                      <input
                        type="number"
                        value={c[field] || ''}
                        onChange={(e) =>
                          updateCargo(c.id, field, Number(e.target.value))
                        }
                        style={{ ...inputStyle, width: 70 }}
                      />
                    </td>
                  ))}
                  <td
                    style={{
                      padding: '8px 10px',
                      color: '#4f8ef7',
                      fontWeight: 700,
                    }}
                  >
                    {calcCbm(c).toFixed(3)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={c.noStack}
                      onChange={(e) =>
                        updateCargo(c.id, 'noStack', e.target.checked)
                      }
                    />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <button
                      onClick={() => removeCargo(c.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#e04040',
                        cursor: 'pointer',
                        fontSize: 16,
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={addCargo}
          style={{
            marginTop: 10,
            background: 'none',
            border: 'none',
            color: '#4f8ef7',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          + 품목 추가
        </button>
        <div
          style={{
            borderTop: '1px solid #eee',
            marginTop: 16,
            paddingTop: 14,
            display: 'flex',
            gap: 24,
            fontSize: 13,
            color: '#555',
            flexWrap: 'wrap',
          }}
        >
          <span>
            총 CBM:{' '}
            <strong style={{ color: '#4f8ef7' }}>{totalCbm.toFixed(3)}</strong>
          </span>
          <span>
            총 중량:{' '}
            <strong style={{ color: '#4f8ef7' }}>
              {totalWeight.toLocaleString()} kg
            </strong>
          </span>
          <span>
            적재율(CBM):{' '}
            <strong
              style={{ color: Number(loadRate) > 100 ? '#e04040' : '#38a169' }}
            >
              {loadRate}%
            </strong>
            {Number(loadRate) > 100 && (
              <span style={{ color: '#e04040', marginLeft: 6 }}>
                ⚠️ 컨테이너 추가 필요!
              </span>
            )}
          </span>
        </div>
      </section>

      <button
        onClick={calculate}
        style={{
          width: '100%',
          padding: 14,
          borderRadius: 8,
          border: 'none',
          background: '#4f8ef7',
          color: 'white',
          fontWeight: 700,
          fontSize: 15,
          cursor: 'pointer',
        }}
      >
        🔍 최적 적재 계산하기
      </button>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  border: '1px solid #e0e0e0',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  width: 90,
  outline: 'none',
};
