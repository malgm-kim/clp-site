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

// ✅ 3D 공간에 실제 배치된 박스
type PlacedBox3D = {
  cargoId: number;
  cargoName: string;
  color: string;
  x: number;
  y: number;
  z: number; // 시작 좌표
  l: number;
  w: number;
  h: number; // 실제 크기 (회전 반영)
  weight: number;
  noStack: boolean;
};

type ContainerLoad3D = {
  containerId: number;
  containerType: (typeof CONTAINER_TYPES)[number];
  boxes: PlacedBox3D[];
  cogX: number;
  cogY: number;
  xImbalance: boolean;
  yImbalance: boolean;
};

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

// ✅ 6방향 회전 (height 작은 것 우선)
function get6Rotations(
  l: number,
  w: number,
  h: number
): [number, number, number][] {
  const seen = new Set<string>();
  return (
    [
      [l, w, h],
      [w, l, h],
      [l, h, w],
      [h, l, w],
      [w, h, l],
      [h, w, l],
    ] as [number, number, number][]
  )
    .filter(([a, b, c]) => {
      const k = `${a},${b},${c}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a[2] - b[2]); // height 작은 것 우선
}

// ✅ 두 박스가 x,y 평면에서 겹치는지
function overlapsXY(
  a: PlacedBox3D,
  bx: number,
  by: number,
  bl: number,
  bw: number
): boolean {
  return a.x < bx + bl && a.x + a.l > bx && a.y < by + bw && a.y + a.w > by;
}

// ✅ 새 박스를 (x,y,z)에 놓을 수 있는지 체크
function canPlace(
  boxes: PlacedBox3D[],
  x: number,
  y: number,
  z: number,
  l: number,
  w: number,
  h: number,
  cL: number,
  cW: number,
  cH: number,
  noStack: boolean,
  weight: number
): boolean {
  // 컨테이너 범위 체크
  if (x + l > cL || y + w > cW || z + h > cH) return false;
  if (x < 0 || y < 0 || z < 0) return false;

  // 다른 박스와 겹치는지 체크
  for (const b of boxes) {
    if (
      b.x < x + l &&
      b.x + b.l > x &&
      b.y < y + w &&
      b.y + b.w > y &&
      b.z < z + h &&
      b.z + b.h > z
    )
      return false;
  }

  if (z === 0) return true; // 바닥이면 OK

  // 지지면 체크: 아래 박스들이 새 박스 바닥을 충분히 받쳐주는지
  const supportArea = calcSupportArea(boxes, x, y, z, l, w);
  const requiredArea = l * w * 0.5; // 50% 이상 지지 필요
  if (supportArea < requiredArea) return false;

  // 다단불가 박스 위에 올리는지 체크
  for (const b of boxes) {
    if (b.noStack && overlapsXY(b, x, y, l, w) && b.z + b.h === z) return false;
  }

  // 하중 체크: 바로 아래 박스들의 허용 하중
  const belowBoxes = boxes.filter(
    (b) => overlapsXY(b, x, y, l, w) && b.z + b.h === z
  );
  for (const b of belowBoxes) {
    const alreadyOnTop = boxes
      .filter((ob) => overlapsXY(ob, b.x, b.y, b.l, b.w) && ob.z >= b.z + b.h)
      .reduce((s, ob) => s + ob.weight, 0);
    if (alreadyOnTop + weight > b.weight) return false;
  }

  return true;
}

// ✅ 지지 면적 계산 (아래 박스들과의 겹치는 면적 합산)
function calcSupportArea(
  boxes: PlacedBox3D[],
  x: number,
  y: number,
  z: number,
  l: number,
  w: number
): number {
  let area = 0;
  const belowBoxes = boxes.filter((b) => b.z + b.h === z);
  for (const b of belowBoxes) {
    const ox = Math.max(x, b.x);
    const oy = Math.max(y, b.y);
    const ex = Math.min(x + l, b.x + b.l);
    const ey = Math.min(y + w, b.y + b.w);
    if (ex > ox && ey > oy) area += (ex - ox) * (ey - oy);
  }
  return area;
}

// ✅ Extreme Points 생성
function getExtremePoints(
  boxes: PlacedBox3D[],
  cL: number,
  cW: number,
  cH: number
): { x: number; y: number; z: number }[] {
  const pts = new Set<string>();
  const add = (x: number, y: number, z: number) => {
    if (x >= 0 && y >= 0 && z >= 0 && x < cL && y < cW && z < cH)
      pts.add(`${x},${y},${z}`);
  };

  add(0, 0, 0); // 원점

  for (const b of boxes) {
    add(b.x + b.l, b.y, b.z); // 박스 오른쪽
    add(b.x, b.y + b.w, b.z); // 박스 앞쪽
    add(b.x, b.y, b.z + b.h); // 박스 위쪽
    add(b.x + b.l, b.y + b.w, b.z); // 박스 오른쪽+앞
    add(b.x + b.l, b.y, b.z + b.h); // 박스 오른쪽+위
    add(b.x, b.y + b.w, b.z + b.h); // 박스 앞+위
  }

  return Array.from(pts)
    .map((s) => {
      const [x, y, z] = s.split(',').map(Number);
      return { x, y, z };
    })
    .sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y); // z 낮은 것 우선
}

function calcCOG(boxes: PlacedBox3D[], cL: number, cW: number) {
  let tw = 0,
    wx = 0,
    wy = 0;
  for (const b of boxes) {
    wx += (b.x + b.l / 2) * b.weight;
    wy += (b.y + b.w / 2) * b.weight;
    tw += b.weight;
  }
  if (tw === 0) return { x: 0.5, y: 0.5 };
  return { x: wx / tw / cL, y: wy / tw / cW };
}

// ✅ 바닥 면적 기준 정렬
function sortCargos(boxes: CargoItem[]): CargoItem[] {
  return [...boxes].sort((a, b) => {
    if (a.noStack !== b.noStack) return a.noStack ? -1 : 1;
    const areaA = a.length * a.width,
      areaB = b.length * b.width;
    if (areaB !== areaA) return areaB - areaA;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.length * b.width * b.height - a.length * a.width * a.height;
  });
}

// ✅ 단일 컨테이너에 3D 패킹
function pack3D(
  cargoList: CargoItem[],
  cargos: CargoItem[],
  ct: (typeof CONTAINER_TYPES)[number]
): { boxes: PlacedBox3D[]; remaining: CargoItem[] } {
  const placed: PlacedBox3D[] = [];
  const remaining: CargoItem[] = [];

  for (const cargo of cargoList) {
    const colorIdx = cargos.findIndex((c) => c.id === cargo.id);
    const color = COLORS[colorIdx % COLORS.length];
    let boxPlaced = false;

    const rotations = get6Rotations(cargo.length, cargo.width, cargo.height);
    const eps = getExtremePoints(placed, ct.length, ct.width, ct.height);

    // Best Fit: 모든 EP × 모든 회전 중 가장 좋은 위치 찾기
    let best: {
      x: number;
      y: number;
      z: number;
      l: number;
      w: number;
      h: number;
      score: number;
    } | null = null;

    for (const ep of eps) {
      for (const [rl, rw, rh] of rotations) {
        if (
          !canPlace(
            placed,
            ep.x,
            ep.y,
            ep.z,
            rl,
            rw,
            rh,
            ct.length,
            ct.width,
            ct.height,
            cargo.noStack,
            cargo.weight
          )
        )
          continue;

        // 점수: z 낮을수록, x 낮을수록, y 낮을수록 좋음
        const score = ep.z * 10000 + ep.x * 100 + ep.y;
        if (!best || score < best.score) {
          best = { x: ep.x, y: ep.y, z: ep.z, l: rl, w: rw, h: rh, score };
        }
      }
    }

    if (best) {
      placed.push({
        cargoId: cargo.id,
        cargoName: cargo.name,
        color,
        x: best.x,
        y: best.y,
        z: best.z,
        l: best.l,
        w: best.w,
        h: best.h,
        weight: cargo.weight,
        noStack: cargo.noStack,
      });
      boxPlaced = true;
    }

    if (!boxPlaced) remaining.push(cargo);
  }

  return { boxes: placed, remaining };
}

function buildContainerLoads(cargos: CargoItem[]): ContainerLoad3D[] {
  let remaining = [...cargos].flatMap((c) =>
    Array.from({ length: c.quantity }, () => ({ ...c, quantity: 1 }))
  );
  const loads: ContainerLoad3D[] = [];
  let containerId = 0;
  let safety = 0;

  while (remaining.length > 0 && safety < 50) {
    safety++;
    const totalCbm = remaining.reduce(
      (s, c) => s + (c.length / 100) * (c.width / 100) * (c.height / 100),
      0
    );
    const totalWeight = remaining.reduce((s, c) => s + c.weight, 0);

    let selectedCt = CONTAINER_TYPES[0];
    for (const ct of CONTAINER_TYPES) {
      if (totalCbm <= ct.maxCbm * 0.92 && totalWeight <= ct.maxWeight) {
        selectedCt = ct;
        break;
      }
    }

    const sorted = sortCargos(remaining);
    const { boxes, remaining: leftover } = pack3D(sorted, cargos, selectedCt);

    if (boxes.length === 0) {
      remaining = leftover.slice(1);
      continue;
    }

    const cog = calcCOG(boxes, selectedCt.length, selectedCt.width);
    loads.push({
      containerId: containerId++,
      containerType: selectedCt,
      boxes,
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
  const [quickInput, setQuickInput] = useState('');
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
  const [containerLoads, setContainerLoads] = useState<ContainerLoad3D[]>([]);
  const [hoveredBox, setHoveredBox] = useState<PlacedBox3D | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

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
    setHoveredBox(null);
  };

  const parseQuickInput = (text: string) => {
    return text
      .split(',')
      .map((item) => {
        let s = item
          .trim()
          .toLowerCase()
          .replace(/[*x]/g, ' ')
          .replace(/\s+/g, ' ')
          .replace(/\((\d+)\)/, ' $1');
        const nums = s.match(/\d+/g);
        if (!nums || nums.length < 3) return null;
        return {
          length: +nums[0],
          width: +nums[1],
          height: +nums[2],
          quantity: nums[3] ? +nums[3] : 1,
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
    const parsed = parseQuickInput(quickInput);
    if (!parsed.length) {
      alert('형식이 잘못됐어요');
      return;
    }
    setCargos((prev) => [
      ...prev,
      ...parsed.map((p) => ({
        id: Date.now() + Math.random(),
        name: '',
        ...p,
        weight: 0,
        noStack: false,
      })),
    ]);
    setQuickInput('');
  };

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

  // 박스 툴팁
  const BoxTooltip = ({ box }: { box: PlacedBox3D }) => (
    <div
      style={{
        position: 'fixed',
        left: tooltipPos.x + 16,
        top: Math.min(tooltipPos.y - 20, window.innerHeight - 300),
        background: 'white',
        border: '2px solid #4f8ef7',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        zIndex: 1000,
        minWidth: 220,
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
        📦 박스 정보
      </div>
      <div
        style={{
          background: box.color,
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 10,
        }}
      >
        <div style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>
          {box.cargoName || '(미입력)'}
        </div>
        <div
          style={{
            color: 'rgba(255,255,255,0.85)',
            fontSize: 11,
            marginTop: 4,
          }}
        >
          크기: {box.l}×{box.w}×{box.h}cm
        </div>
        <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>
          중량: {box.weight}kg
        </div>
        {box.noStack && (
          <div style={{ color: '#ffcccc', fontSize: 11 }}>❌ 다단 불가</div>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#666' }}>
        <div>
          위치: X={box.x}cm / Y={box.y}cm / Z={box.z}cm
        </div>
        <div>허용 하중: {box.weight}kg</div>
      </div>
    </div>
  );

  if (page === 'result') {
    const totalContainers = containerLoads.length;
    const cargoColors = cargos.map((c, i) => ({
      ...c,
      color: COLORS[i % COLORS.length],
    }));
    const DL = 660,
      DW = 180,
      DH = 120; // 상면도/측면도 표시 크기

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
          3D Extreme Points · 6방향 회전 · 자동 컨테이너 선택
        </p>

        {/* 요약 카드 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${2 + summary.length},1fr)`,
            gap: 16,
            marginBottom: 24,
          }}
        >
          {[
            {
              label: '총 컨테이너',
              value: `${totalContainers}개`,
              color: '#1a1a2e',
              sub: '자동 선택',
            },
            {
              label: '총 CBM',
              value: totalCbm.toFixed(2),
              color: '#4f8ef7',
              sub: 'm³',
            },
            ...summary.map((s) => ({
              label: s.name,
              value: `${s.count}개`,
              color: '#38a169',
              sub: `최대 ${s.maxCbm} CBM`,
            })),
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

        {/* 컨테이너별 배치도 */}
        {containerLoads.map((load, ci) => {
          const ct = load.containerType;
          const loadedCbm = load.boxes.reduce(
            (s, b) => s + (b.l / 100) * (b.w / 100) * (b.h / 100),
            0
          );
          const loadedWeight = load.boxes.reduce((s, b) => s + b.weight, 0);
          const cbmRate = ((loadedCbm / ct.maxCbm) * 100).toFixed(1);
          const scaleL = DL / ct.length,
            scaleW = DW / ct.width,
            scaleH = DH / ct.height;

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
                    중량:{' '}
                    <strong style={{ color: '#4f8ef7' }}>
                      {loadedWeight.toLocaleString()}
                    </strong>{' '}
                    / {ct.maxWeight.toLocaleString()}kg
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
                  }}
                />
              </div>

              {/* 상면도 + 측면도 */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                {/* 상면도 (x-y 평면, 위에서 내려다봄) */}
                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                    📐 상면도 (위에서)
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      width: DL + 4,
                      height: DW + 4,
                      background: '#eef4ff',
                      border: '3px solid #4f8ef7',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 3,
                        left: 6,
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#4f8ef7',
                        zIndex: 2,
                      }}
                    >
                      {ct.name}
                    </div>

                    {/* 무게중심 */}
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

                    {/* 박스들 (z 낮은 것 먼저, 높은 것이 위에 렌더링) */}
                    {[...load.boxes]
                      .sort((a, b) => a.z - b.z)
                      .map((box, bi) => {
                        const isHovered = hoveredBox === box;
                        const px = box.x * scaleL,
                          py = box.y * scaleW;
                        const pw = box.l * scaleL,
                          ph = box.w * scaleW;
                        // z가 높을수록 약간 어둡게
                        const opacity = 0.6 + (box.z / ct.height) * 0.4;
                        return (
                          <div
                            key={bi}
                            onMouseEnter={(e) => {
                              setHoveredBox(box);
                              setTooltipPos({ x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) =>
                              setTooltipPos({ x: e.clientX, y: e.clientY })
                            }
                            onMouseLeave={() => setHoveredBox(null)}
                            style={{
                              position: 'absolute',
                              left: px,
                              top: py,
                              width: pw,
                              height: ph,
                              background: box.color,
                              opacity,
                              borderRadius: 2,
                              cursor: 'pointer',
                              overflow: 'hidden',
                              border: isHovered
                                ? '2px solid white'
                                : '1px solid rgba(255,255,255,0.4)',
                              boxShadow: isHovered
                                ? '0 0 0 2px #1a1a2e'
                                : 'none',
                              zIndex: isHovered ? 20 : box.z + 1,
                              transition: 'all 0.1s ease',
                            }}
                          >
                            {pw > 20 && ph > 14 && (
                              <div
                                style={{
                                  color: 'white',
                                  fontSize: 7,
                                  fontWeight: 700,
                                  padding: 2,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {box.cargoName || '화물'}
                              </div>
                            )}
                            {box.noStack && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 1,
                                  right: 1,
                                  background: '#fff0f0',
                                  color: '#e04040',
                                  fontSize: 5,
                                  padding: '0 2px',
                                  borderRadius: 1,
                                  fontWeight: 800,
                                }}
                              >
                                NO
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
                      fontSize: 9,
                      color: '#aaa',
                      marginTop: 2,
                    }}
                  >
                    <span>← 0</span>
                    <span>{ct.length}cm →</span>
                  </div>
                </div>

                {/* 측면도 (x-z 평면, 옆에서 봄) */}
                <div>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                    📐 측면도 (옆에서)
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      width: DL + 4,
                      height: DH + 4,
                      background: '#f0fff4',
                      border: '3px solid #38a169',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                  >
                    {[...load.boxes]
                      .sort((a, b) => a.y - b.y)
                      .map((box, bi) => {
                        const isHovered = hoveredBox === box;
                        const px = box.x * scaleL;
                        const pz = (ct.height - box.z - box.h) * scaleH; // z축 반전 (위가 높음)
                        const pw = box.l * scaleL,
                          ph = box.h * scaleH;
                        const opacity = 0.5 + (box.y / ct.width) * 0.5;
                        return (
                          <div
                            key={bi}
                            onMouseEnter={(e) => {
                              setHoveredBox(box);
                              setTooltipPos({ x: e.clientX, y: e.clientY });
                            }}
                            onMouseMove={(e) =>
                              setTooltipPos({ x: e.clientX, y: e.clientY })
                            }
                            onMouseLeave={() => setHoveredBox(null)}
                            style={{
                              position: 'absolute',
                              left: px,
                              top: pz,
                              width: pw,
                              height: ph,
                              background: box.color,
                              opacity,
                              borderRadius: 2,
                              cursor: 'pointer',
                              overflow: 'hidden',
                              border: isHovered
                                ? '2px solid white'
                                : '1px solid rgba(255,255,255,0.4)',
                              boxShadow: isHovered
                                ? '0 0 0 2px #1a1a2e'
                                : 'none',
                              zIndex: isHovered
                                ? 20
                                : 10 - Math.floor((box.y / ct.width) * 10),
                              transition: 'all 0.1s ease',
                            }}
                          >
                            {pw > 20 && ph > 14 && (
                              <div
                                style={{
                                  color: 'white',
                                  fontSize: 7,
                                  fontWeight: 700,
                                  padding: 2,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {box.cargoName || '화물'}
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
                      fontSize: 9,
                      color: '#aaa',
                      marginTop: 2,
                    }}
                  >
                    <span>← 0</span>
                    <span>{ct.length}cm →</span>
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>
                💡 박스에 마우스를 올리면 상세 정보가 표시됩니다 · 상면도:
                위에서 본 뷰 · 측면도: 옆에서 본 뷰
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
            marginBottom: 12,
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

        {hoveredBox && <BoxTooltip box={hoveredBox} />}
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
        position: 'relative',
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
          fontSize: 14,
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
          화물 품목 입력
        </h2>

        <div
          style={{
            marginBottom: 16,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <input
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd()}
            placeholder="예: 291x111x142(2), 100x80x60(5)"
            style={{
              border: '1px solid #ddd',
              padding: '8px 10px',
              borderRadius: 6,
              width: 280,
              fontSize: 13,
            }}
          />
          <button
            onClick={handleQuickAdd}
            style={{
              padding: '8px 14px',
              background: '#4f8ef7',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            빠른 추가
          </button>
          <span style={{ fontSize: 11, color: '#aaa' }}>
            쉼표로 여러 개 한번에 입력 가능
          </span>
        </div>

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
        🔍 최적 적재 계산하기 (3D)
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
