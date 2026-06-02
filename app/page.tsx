'use client';

import { useState } from 'react';

const CONTAINER_TYPES = [
  {
    name: '40HQ',
    length: 1200,
    width: 235,
    height: 269,
    maxCbm: 76.4,
    maxWeight: 26680,
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
    name: '20GP',
    length: 589,
    width: 235,
    height: 239,
    maxCbm: 33.2,
    maxWeight: 21700,
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

type ContainerLoad = {
  containerId: number;
  containerType: (typeof CONTAINER_TYPES)[number];
  cells: Cell[];
  usedLength: number;
  cogX: number;
  cogY: number;
  xImbalance: boolean;
  yImbalance: boolean;
};

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

function simulateFill(freeRects: FreeRect[], remaining: CargoItem[]): number {
  let score = 0;
  let rects = [...freeRects];

  for (const box of remaining.slice(0, 3)) {
    // 👉 3개만 미리봄 (성능용)
    let placed = false;

    for (const rect of rects) {
      if (box.length <= rect.w && box.width <= rect.h) {
        rects = splitMaxRects(rects, rect.x, rect.y, box.length, box.width);
        score += 1;
        placed = true;
        break;
      }
    }

    if (!placed) break;
  }

  return score;
}

function get6Rotations(
  l: number,
  w: number,
  h: number
): [number, number, number][] {
  const seen = new Set<string>();
  return [
    [l, w, h],
    [l, h, w],
    [w, l, h],
    [w, h, l],
    [h, l, w],
    [h, w, l],
  ].filter(([a, b, c]) => {
    const k = `${a},${b},${c}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }) as [number, number, number][];
}

function calcLoadAbove(boxes: PlacedBox[], layerIdx: number): number {
  return boxes.slice(layerIdx + 1).reduce((s, b) => s + b.weight, 0);
}

function canStackOn(cell: Cell, newBox: { weight: number }): boolean {
  if (cell.boxes.length === 0) return true;
  return calcLoadAbove(cell.boxes, 0) + newBox.weight <= cell.boxes[0].weight;
}

function maxRectsBSSF(
  freeRects: FreeRect[],
  bw: number,
  bh: number
): { rect: FreeRect; score: number } | null {
  let best: { rect: FreeRect; score: number } | null = null;
  for (const r of freeRects) {
    if (bw > r.w || bh > r.h) continue;
    const score = Math.min(r.w - bw, r.h - bh);
    if (!best || score < best.score) best = { rect: r, score };
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
  for (const r of freeRects) {
    if (
      px >= r.x + r.w ||
      px + pw <= r.x ||
      py >= r.y + r.h ||
      py + ph <= r.y
    ) {
      result.push(r);
      continue;
    }
    if (py > r.y) result.push({ x: r.x, y: r.y, w: r.w, h: py - r.y });
    if (py + ph < r.y + r.h)
      result.push({ x: r.x, y: py + ph, w: r.w, h: r.y + r.h - (py + ph) });
    if (px > r.x) result.push({ x: r.x, y: py, w: px - r.x, h: ph });
    if (px + pw < r.x + r.w)
      result.push({ x: px + pw, y: py, w: r.x + r.w - (px + pw), h: ph });
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

function calcCOG(cells: Cell[], cL: number, cW: number) {
  let tw = 0,
    wx = 0,
    wy = 0;
  for (const c of cells) {
    const w = c.boxes.reduce((s, b) => s + b.weight, 0);
    wx += (c.x + c.cellLength / 2) * w;
    wy += (c.y + c.cellWidth / 2) * w;
    tw += w;
  }
  if (tw === 0) return { x: 0.5, y: 0.5 };
  return { x: wx / tw / cL, y: wy / tw / cW };
}

type ActiveContainer = {
  freeRects: FreeRect[];
  cells: Cell[];
  usedLength: number;
  containerType: (typeof CONTAINER_TYPES)[number];
};

// 단일 컨테이너에 박스들 최대한 채우기 → 남은 박스 반환
function packIntoContainer(
  boxes: CargoItem[],
  cargos: CargoItem[],
  ct: (typeof CONTAINER_TYPES)[number],
  cellIdRef: { v: number }
): { cells: Cell[]; remaining: CargoItem[] } {
  const container: ActiveContainer = {
    freeRects: [{ x: 0, y: 0, w: ct.length, h: ct.width }],
    cells: [],
    usedLength: 0,
    containerType: ct,
  };

  const remaining: CargoItem[] = [];

  boxes.sort((a, b) => {
    const areaA = a.length * a.width;
    const areaB = b.length * b.width;

    if (areaA !== areaB) return areaB - areaA;

    return b.height - a.height;
  });

  for (let i = 0; i < boxes.length; i++) {
    const cargo = boxes[i];

    const remainingBoxes = boxes.slice(i + 1); // ✅ 여기로 이동

    if (
      cargo.height > ct.height &&
      cargo.width > ct.height &&
      cargo.length > ct.height
    ) {
      remaining.push(cargo);
      continue;
    }

    if (
      cargo.height > ct.height &&
      cargo.width > ct.height &&
      cargo.length > ct.height
    ) {
      remaining.push(cargo);
      continue;
    }

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

    // 다단 쌓기 시도
    if (!cargo.noStack) {
      for (const cell of container.cells) {
        if (cell.noStack) continue;
        if (!canStackOn(cell, box)) continue;
        const rotations = get6Rotations(
          cargo.length,
          cargo.width,
          cargo.height
        );
        for (const [rl, rw, rh] of rotations) {
          if (
            cell.cellLength >= rl &&
            cell.cellWidth >= rw &&
            cell.usedHeight + rh <= ct.height
          ) {
            cell.boxes.push({
              ...box,
              length: rl,
              width: rw,
              height: rh,
              layer: cell.boxes.length + 1,
            });
            cell.usedHeight += rh;
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }

    // 새 셀 배치
    if (!placed) {
      const rotations = get6Rotations(cargo.length, cargo.width, cargo.height);
      let bestFit: {
        rect: FreeRect;
        rl: number;
        rw: number;
        rh: number;
        score: number;
      } | null = null;
      for (const [rl, rw, rh] of rotations) {
        if (rh > ct.height) continue;
        // 🔥 모든 freeRects + 모든 회전 직접 탐색
        for (const rect of container.freeRects) {
          if (rl <= rect.w && rw <= rect.h) {
            // 🔥 Lookahead 점수 추가
            const baseScore = Math.min(rect.w - rl, rect.h - rw);

            // 👉 임시 freeRects 만들기
            const newRects = splitMaxRects(
              container.freeRects,
              rect.x,
              rect.y,
              rl,
              rw
            );

            // 👉 다음 박스 시뮬레이션
            const futureScore = simulateFill(newRects, remainingBoxes);

            // 👉 최종 점수
            const score = baseScore - futureScore * 10;
            if (!bestFit || score < bestFit.score) {
              bestFit = {
                rect,
                rl,
                rw,
                rh,
                score,
              };
            }
          }
        }
      }
      if (bestFit) {
        container.cells.push({
          cellId: cellIdRef.v++,
          x: bestFit.rect.x,
          y: bestFit.rect.y,
          cellLength: bestFit.rl,
          cellWidth: bestFit.rw,
          boxes: [
            {
              ...box,
              length: bestFit.rl,
              width: bestFit.rw,
              height: bestFit.rh,
              layer: 1,
            },
          ],
          usedHeight: bestFit.rh,
          noStack: cargo.noStack,
        });
        container.freeRects = splitMaxRects(
          container.freeRects,
          bestFit.rect.x,
          bestFit.rect.y,
          bestFit.rl,
          bestFit.rw
        );
        placed = true;
      }
    }

    if (!placed) remaining.push(cargo);
  }

  return { cells: container.cells, remaining };
}

// 여러 정렬 전략 시도 → 가장 적게 남는 결과 선택
function packBestStrategy(
  boxes: CargoItem[],
  cargos: CargoItem[],
  ct: (typeof CONTAINER_TYPES)[number],
  cellIdRef: { v: number }
): { cells: Cell[]; remaining: CargoItem[] } {
  const strategies = [
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return (
          Math.max(z.length, z.width, z.height) -
          Math.max(a.length, a.width, a.height)
        );
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

  let best: { cells: Cell[]; remaining: CargoItem[] } | null = null;
  const savedId = cellIdRef.v;

  for (const s of strategies) {
    cellIdRef.v = savedId;
    const result = packIntoContainer(s(boxes), cargos, ct, cellIdRef);
    if (!best || result.remaining.length < best.remaining.length) best = result;
    if (best.remaining.length === 0) break;
  }
  return best!;
}

// ✅ 메인 로직: 자동 컨테이너 선택 + 순차 적재
function buildContainerLoads(cargos: CargoItem[]): ContainerLoad[] {
  // 박스 1개씩 펼치기
  let remaining = [...cargos].flatMap((c) =>
    Array.from({ length: c.quantity }, () => ({ ...c, quantity: 1 }))
  );
  const loads: ContainerLoad[] = [];
  const cellIdRef = { v: 0 };
  let containerId = 0;

  while (remaining.length > 0) {
    // ✅ 남은 화물의 총 CBM 계산
    const totalCbm = remaining.reduce(
      (s, c) => s + (c.length / 100) * (c.width / 100) * (c.height / 100),
      0
    );
    const totalWeight = remaining.reduce((s, c) => s + c.weight, 0);

    // ✅ 컨테이너 자동 선택: 40HQ → 40GP → 20GP
    // CBM과 중량 모두 고려해서 가장 적합한 컨테이너 선택
    let selectedCt = CONTAINER_TYPES[0]; // 기본 40HQ
    for (const ct of CONTAINER_TYPES) {
      if (totalCbm <= ct.maxCbm * 0.9 && totalWeight <= ct.maxWeight) {
        selectedCt = ct;
        break;
      }
    }

    // ✅ 선택된 컨테이너에 최적 적재
    const { cells, remaining: leftover } = packBestStrategy(
      remaining,
      cargos,
      selectedCt,
      cellIdRef
    );

    // 무한루프 방지: 아무것도 못 넣으면 강제로 다음 컨테이너
    if (cells.length === 0) {
      remaining = leftover.slice(1); // 못 넣는 화물 스킵
      continue;
    }

    const usedLength =
      cells.length > 0 ? Math.max(...cells.map((c) => c.x + c.cellLength)) : 0;
    const cog = calcCOG(cells, selectedCt.length, selectedCt.width);

    loads.push({
      containerId: containerId++,
      containerType: selectedCt,
      cells,
      usedLength,
      cogX: cog.x,
      cogY: cog.y,
      xImbalance: Math.abs(cog.x - 0.5) > 0.1,
      yImbalance: Math.abs(cog.y - 0.5) > 0.1,
    });

    remaining = leftover;
  }

  return loads;
}

export default function Home() {
  const handleReset = () => {
    setCargos([
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

    setContainerLoads([]);
    setPage('input');
    setQuickInput('');
    setHoveredCell(null);
  };
  const [quickInput, setQuickInput] = useState('');
  const parseMultipleQuickInput = (text: string) => {
    return text
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        let cleaned = item.toLowerCase().trim();

        // 🔥 x, *, 공백 통일
        cleaned = cleaned.replace(/[*x]/g, ' ');
        cleaned = cleaned.replace(/\s+/g, ' ');

        // 🔥 (2) → 2
        cleaned = cleaned.replace(/\((\d+)\)/, ' $1');

        // 🔥 숫자만 추출
        const numbers = cleaned.match(/\d+/g);

        if (!numbers || numbers.length < 3) return null;

        const length = Number(numbers[0]);
        const width = Number(numbers[1]);
        const height = Number(numbers[2]);
        const quantity = numbers[3] ? Number(numbers[3]) : 1;

        return {
          length,
          width,
          height,
          quantity,
        };
      })
      .filter(Boolean) as {
      length: number;
      width: number;
      height: number;
      quantity: number;
    }[];
  };
  const handleQuickAdd = () => {
    const parsedList = parseMultipleQuickInput(quickInput);

    if (!parsedList.length) {
      alert('형식이 잘못됐어요');
      return;
    }

    const newItems = parsedList.map((p) => ({
      id: Date.now() + Math.random(),
      name: '',
      length: p.length,
      width: p.width,
      height: p.height,
      weight: 0,
      quantity: p.quantity,
      noStack: false,
    }));

    setCargos((prev) => [...prev, ...newItems]);
    setQuickInput('');
  };
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
  const totalCbm = cargos.reduce((s, c) => s + calcCbm(c), 0);
  const totalWeight = cargos.reduce((s, c) => s + c.weight * c.quantity, 0);

  const calculate = () => {
    setContainerLoads(buildContainerLoads(cargos));
    setPage('result');
  };

  const StackTooltip = ({ cell }: { cell: Cell }) => (
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
          const isOverload =
            layerIdx === 0 &&
            cell.boxes.length > 1 &&
            loadAbove > cell.boxes[0].weight;
          return (
            <div
              key={ri}
              style={{
                width: 180,
                minHeight: 52,
                background: isOverload ? '#e04040' : box.color,
                borderRadius: 6,
                padding: '6px 10px',
                border: isOverload
                  ? '2px solid #ff4444'
                  : '2px solid transparent',
              }}
            >
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
                크기: {box.length}×{box.width}×{box.height}cm · {box.weight}kg
              </div>
              {loadAbove > 0 && (
                <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 9 }}>
                  위 하중: +{loadAbove}kg → 합계 {box.weight + loadAbove}kg
                </div>
              )}
              {layerIdx === 0 && cell.boxes.length > 1 && (
                <div
                  style={{
                    color: isOverload ? '#ffcccc' : 'rgba(255,255,255,0.7)',
                    fontSize: 9,
                  }}
                >
                  허용 하중: {cell.boxes[0].weight}kg {isOverload ? '❌' : '✅'}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          width: 200,
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
          사용 높이: <strong>{cell.usedHeight}cm</strong>
        </div>
        <div>
          총 중량:{' '}
          <strong>{cell.boxes.reduce((s, b) => s + b.weight, 0)}kg</strong>
        </div>
      </div>
    </div>
  );

  if (page === 'result') {
    const totalContainers = containerLoads.length;
    const cargoColors = cargos.map((c, i) => ({
      ...c,
      color: COLORS[i % COLORS.length],
    }));
    const DISPLAY_LENGTH = 660;
    const DISPLAY_WIDTH = 180;

    // 컨테이너 타입별 요약
    const summary = CONTAINER_TYPES.map((ct) => ({
      ...ct,
      count: containerLoads.filter((l) => l.containerType.name === ct.name)
        .length,
    })).filter((s) => s.count > 0);

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
          3D 6방향 회전 · 자동 컨테이너 선택
        </p>

        {/* 요약 카드 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${2 + summary.length}, 1fr)`,
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div
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
              총 컨테이너
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#1a1a2e' }}>
              {totalContainers}개
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
              자동 선택
            </div>
          </div>
          <div
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
              총 CBM
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#4f8ef7' }}>
              {totalCbm.toFixed(2)}
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>m³</div>
          </div>
          {summary.map((s) => (
            <div
              key={s.name}
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
                {s.name}
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#38a169' }}>
                {s.count}개
              </div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
                최대 {s.maxCbm} CBM
              </div>
            </div>
          ))}
        </div>

        {/* 컨테이너별 배치도 */}
        {containerLoads.map((load, ci) => {
          const ct = load.containerType;
          const colLoadRate = ((load.usedLength / ct.length) * 100).toFixed(1);
          const scaleL = DISPLAY_LENGTH / ct.length;
          const scaleW = DISPLAY_WIDTH / ct.width;
          const loadedCbm = load.cells.reduce(
            (s, cell) =>
              s +
              cell.boxes.reduce(
                (bs, b) =>
                  bs + (b.length / 100) * (b.width / 100) * (b.height / 100),
                0
              ),
            0
          );
          const cbmRate = ((loadedCbm / ct.maxCbm) * 100).toFixed(1);

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
              {/* 헤더 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                  <span
                    style={{
                      background: '#eef4ff',
                      color: '#4f8ef7',
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: 20,
                    }}
                  >
                    {ct.name}
                  </span>
                  {(load.xImbalance || load.yImbalance) && (
                    <span
                      style={{
                        background: '#fff0f0',
                        color: '#e04040',
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 20,
                      }}
                    >
                      ⚠️ 무게 편중
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    fontSize: 12,
                    color: '#666',
                  }}
                >
                  <span>
                    CBM:{' '}
                    <strong style={{ color: '#4f8ef7' }}>
                      {loadedCbm.toFixed(2)}
                    </strong>{' '}
                    / {ct.maxCbm}
                  </span>
                  <span>
                    적재율:{' '}
                    <strong
                      style={{
                        color: Number(cbmRate) > 90 ? '#38a169' : '#e07b30',
                      }}
                    >
                      {cbmRate}%
                    </strong>
                  </span>
                </div>
              </div>

              {/* CBM 프로그레스 바 */}
              <div
                style={{
                  background: '#f0f0f0',
                  borderRadius: 4,
                  height: 8,
                  marginBottom: 16,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Number(cbmRate))}%`,
                    height: '100%',
                    background: Number(cbmRate) > 90 ? '#38a169' : '#4f8ef7',
                    borderRadius: 4,
                    transition: 'width 0.3s',
                  }}
                />
              </div>

              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                ↔ 길이 방향 &nbsp; ↕ 폭 방향 &nbsp; 💡 셀에 마우스를 올리면 스택
                + 하중 뷰
              </div>

              {/* 상면도 */}
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
                  {ct.name} #{ci + 1}
                </div>

                {/* 무게중심 오버레이 (표시는 하되 UI 카드는 숨김) */}
                <div
                  style={{
                    position: 'absolute',
                    top: `${load.cogY * 100}%`,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: '#e04040',
                    opacity: 0.3,
                    zIndex: 3,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: `${load.cogX * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: '#e04040',
                    opacity: 0.3,
                    zIndex: 3,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: `${load.cogX * 100}%`,
                    top: `${load.cogY * 100}%`,
                    transform: 'translate(-50%,-50%)',
                    zIndex: 4,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background:
                      load.xImbalance || load.yImbalance
                        ? '#e04040'
                        : '#38a169',
                    border: '2px solid white',
                    boxShadow: '0 0 4px rgba(0,0,0,0.4)',
                  }}
                />

                {load.cells.map((cell) => {
                  const isHovered = hoveredCell?.cellId === cell.cellId;
                  const px = cell.x * scaleL,
                    py = cell.y * scaleW;
                  const pw = cell.cellLength * scaleL,
                    ph = cell.cellWidth * scaleW;
                  const hasOverload =
                    cell.boxes.length > 1 &&
                    calcLoadAbove(cell.boxes, 0) > cell.boxes[0].weight;

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
                        boxShadow: isHovered ? '0 0 0 2px #1a1a2e' : 'none',
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
                }}
              >
                <span>← 0cm</span>
                <span>{ct.length}cm →</span>
              </div>
            </div>
          );
        })}

        {/* 범례 */}
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

        {/* 품목별 요약 */}
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
        <button
          onClick={handleReset}
          style={{
            width: '100%',
            marginTop: 10,
            padding: 14,
            borderRadius: 8,
            border: '1px solid #e04040',
            background: 'white',
            color: '#e04040',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          🗑️ 초기화
        </button>
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
        화물을 입력하면 최적 컨테이너를 자동으로 선택해드립니다.
      </p>
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          fontWeight: 'bold',
          fontSize: '14px',
          color: '#555',
        }}
      >
        MADE BY ZERO
      </div>
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
            marginBottom: 4,
            textTransform: 'uppercase',
          }}
        >
          컨테이너 자동 선택 기준
        </h2>
        <p style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
          40HQ → 40GP → 20GP 순으로 가장 효율적인 조합을 자동 계산합니다.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {CONTAINER_TYPES.map((ct) => (
            <div
              key={ct.name}
              style={{
                background: '#f7f9fc',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 12,
              }}
            >
              <strong>{ct.name}</strong> &nbsp;
              <span style={{ color: '#888' }}>
                최대 {ct.maxCbm} CBM / {ct.maxWeight.toLocaleString()} kg
              </span>
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
          <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
            <input
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              placeholder="예: 291x111x142(2)"
              style={{
                border: '1px solid #ddd',
                padding: '8px 10px',
                borderRadius: 6,
                width: 220,
              }}
            />

            <button
              onClick={handleQuickAdd}
              style={{
                padding: '8px 12px',
                background: '#4f8ef7',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              추가
            </button>
          </div>
          화물 품목 입력
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
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>
          💡 허용 하중은 1단 박스의 자체 중량으로 자동 계산됩니다.
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
// 🔥 정렬 함수 추가
function sortCargoAdvanced(boxes: CargoItem[]) {
  return [...boxes].sort((a, b) => {
    if (a.noStack !== b.noStack) return a.noStack ? -1 : 1;

    const volA = a.length * a.width * a.height;
    const volB = b.length * b.width * b.height;
    if (volB !== volA) return volB - volA;

    if (b.weight !== a.weight) return b.weight - a.weight;

    const maxA = Math.max(a.length, a.width, a.height);
    const maxB = Math.max(b.length, b.width, b.height);
    return maxB - maxA;
  });
}
