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

type Column = {
  colId: number;
  boxes: PlacedBox[];
  usedHeight: number;
  colLength: number; // 이 열이 차지하는 길이(cm)
  colWidth: number; // 이 열이 차지하는 폭(cm)
};

type ContainerLoad = {
  containerId: number;
  columns: Column[];
  usedLength: number;
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

// 핵심 배치 알고리즘 - 컨테이너 길이/폭/높이 모두 체크
function buildContainerLoads(
  cargos: CargoItem[],
  containerLength: number,
  containerWidth: number,
  containerHeight: number
): ContainerLoad[] {
  const containerLoads: ContainerLoad[] = [];
  let containerId = 0;
  let colId = 0;

  // 현재 컨테이너 생성
  const newContainer = (): ContainerLoad => ({
    containerId: containerId++,
    columns: [],
    usedLength: 0,
  });

  let currentContainer = newContainer();
  containerLoads.push(currentContainer);

  // 박스 1개씩 펼치고 정렬
  const allBoxes = [...cargos]
    .flatMap((c) => {
      const arr = [];
      for (let i = 0; i < c.quantity; i++) arr.push(c);
      return arr;
    })
    .sort((a, b) => {
      if (a.noStack !== b.noStack) return a.noStack ? -1 : 1;
      return b.weight - a.weight;
    });

  for (const cargo of allBoxes) {
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

    // 화물이 컨테이너 폭보다 크면 스킵 (실제론 회전 고려해야 하지만 MVP에선 단순화)
    const fitsWidth = cargo.width <= containerWidth;
    const fitsHeight = cargo.height <= containerHeight;

    if (!fitsWidth || !fitsHeight) continue; // 너무 큰 화물은 제외

    let placed = false;

    if (!cargo.noStack) {
      // 다단 가능: 기존 열에 쌓기 시도
      for (const col of currentContainer.columns) {
        const hasNoStack = col.boxes.some(
          (b) => cargos.find((c) => c.id === b.cargoId)?.noStack
        );
        if (hasNoStack) continue;
        if (col.usedHeight + cargo.height <= containerHeight) {
          col.boxes.push({ ...box, layer: col.boxes.length + 1 });
          col.usedHeight += cargo.height;
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      // 새 열 필요 — 현재 컨테이너에 길이 여유 있는지 확인
      if (currentContainer.usedLength + cargo.length > containerLength) {
        // 현재 컨테이너 꽉 참 → 새 컨테이너
        currentContainer = newContainer();
        containerLoads.push(currentContainer);
      }

      const newCol: Column = {
        colId: colId++,
        boxes: [{ ...box, layer: 1 }],
        usedHeight: cargo.height,
        colLength: cargo.length,
        colWidth: cargo.width,
      };
      currentContainer.columns.push(newCol);
      currentContainer.usedLength += cargo.length;
    }
  }

  return containerLoads;
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
  const [hoveredCol, setHoveredCol] = useState<Column | null>(null);
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

  const StackTooltip = ({ col }: { col: Column }) => {
    const boxW = 120;
    const boxH = 52;
    return (
      <div
        style={{
          position: 'fixed',
          left: tooltipPos.x + 16,
          top: Math.min(tooltipPos.y - 20, window.innerHeight - 320),
          background: 'white',
          border: '2px solid #4f8ef7',
          borderRadius: 12,
          padding: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          zIndex: 1000,
          minWidth: 200,
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
          📦 정면 스택 뷰
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
          {[...col.boxes].reverse().map((box, i) => (
            <div
              key={i}
              style={{
                width: boxW,
                height: boxH,
                background: box.color,
                borderRadius: 6,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 10,
                fontWeight: 700,
                position: 'relative',
              }}
            >
              {cargos.find((c) => c.id === box.cargoId)?.noStack && (
                <div
                  style={{
                    position: 'absolute',
                    top: 3,
                    right: 4,
                    background: '#fff0f0',
                    color: '#e04040',
                    fontSize: 8,
                    padding: '1px 4px',
                    borderRadius: 3,
                    fontWeight: 800,
                  }}
                >
                  NO STACK
                </div>
              )}
              <div>{box.cargoName || '(미입력)'}</div>
              <div style={{ fontSize: 9, opacity: 0.85 }}>
                {box.layer}단 · {box.height}cm · {box.weight}kg
              </div>
            </div>
          ))}
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
            사용 높이: <strong>{col.usedHeight}cm</strong> /{' '}
            {selectedContainer.height}cm
          </div>
          <div style={{ marginTop: 2 }}>총 {col.boxes.length}단 적재</div>
          {col.boxes.length > 1 && (
            <div style={{ marginTop: 4, color: '#aaa', fontSize: 10 }}>
              💡 무거운 화물이 아래에 배치됩니다
            </div>
          )}
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

        {/* 요약 카드 */}
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

        {/* 컨테이너별 배치도 */}
        {containerLoads.map((load, ci) => {
          const usedLengthRatio = load.usedLength / selectedContainer.length;
          const loadRate = (usedLengthRatio * 100).toFixed(1);

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
                    적재율:{' '}
                    <strong
                      style={{
                        color: Number(loadRate) > 90 ? '#38a169' : '#e07b30',
                      }}
                    >
                      {loadRate}%
                    </strong>
                  </span>
                </div>
              </div>

              {/* 길이 프로그레스 바 */}
              <div
                style={{
                  background: '#f0f0f0',
                  borderRadius: 4,
                  height: 6,
                  marginBottom: 12,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Number(loadRate))}%`,
                    height: '100%',
                    background: Number(loadRate) > 90 ? '#38a169' : '#4f8ef7',
                    borderRadius: 4,
                    transition: 'width 0.3s',
                  }}
                />
              </div>

              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 10 }}>
                💡 열에 마우스를 올리면 정면 스택 뷰가 나타납니다
              </div>

              {/* 상면도 */}
              <div
                style={{
                  background: '#eef4ff',
                  border: '3px solid #4f8ef7',
                  borderRadius: 8,
                  padding: '28px 12px 8px',
                  minHeight: 140,
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 4,
                  position: 'relative',
                  overflowX: 'auto',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    left: 12,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#4f8ef7',
                  }}
                >
                  {selectedContainer.name} #{ci + 1}
                </div>

                {load.columns.map((col) => {
                  const isHovered = hoveredCol?.colId === col.colId;
                  const colDisplayWidth = Math.max(
                    48,
                    Math.min(
                      140,
                      (col.colLength / selectedContainer.length) * 700
                    )
                  );
                  const colDisplayHeight = Math.max(80, 44 * col.boxes.length);

                  return (
                    <div
                      key={col.colId}
                      onMouseEnter={(e) => {
                        setHoveredCol(col);
                        setTooltipPos({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) =>
                        setTooltipPos({ x: e.clientX, y: e.clientY })
                      }
                      onMouseLeave={() => setHoveredCol(null)}
                      style={{
                        width: colDisplayWidth,
                        height: colDisplayHeight,
                        borderRadius: 6,
                        cursor: 'pointer',
                        position: 'relative',
                        transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                        transition: 'all 0.15s ease',
                        boxShadow: isHovered
                          ? '0 4px 16px rgba(0,0,0,0.2)'
                          : 'none',
                        zIndex: isHovered ? 10 : 1,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'row',
                        flexShrink: 0,
                      }}
                    >
                      {col.boxes.map((box, i) => (
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
                            fontSize: 8,
                            fontWeight: 700,
                            textAlign: 'center',
                            borderRight:
                              i < col.boxes.length - 1
                                ? '1px solid rgba(255,255,255,0.4)'
                                : 'none',
                            padding: 2,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '100%',
                            }}
                          >
                            {box.cargoName || '화물'}
                          </div>
                          <div style={{ fontSize: 7, opacity: 0.8 }}>
                            {box.layer}단
                          </div>
                        </div>
                      ))}
                      {cargos.find((c) => c.id === col.boxes[0]?.cargoId)
                        ?.noStack && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 3,
                            right: 3,
                            background: '#fff0f0',
                            color: '#e04040',
                            fontSize: 7,
                            padding: '1px 3px',
                            borderRadius: 3,
                            fontWeight: 800,
                          }}
                        >
                          NO STACK
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 빈 공간 */}
                {load.usedLength < selectedContainer.length && (
                  <div
                    style={{
                      flex: 1,
                      minWidth: 40,
                      height: 60,
                      background: '#dde4f0',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#aaa',
                      fontSize: 11,
                      flexShrink: 0,
                    }}
                  >
                    빈 공간
                    <br />
                    {selectedContainer.length - load.usedLength}cm
                  </div>
                )}
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
                    '총중량(kg)',
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
                    <td style={{ padding: '10px' }}>
                      {(c.weight * c.quantity).toLocaleString()}
                    </td>
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

        {hoveredCol && <StackTooltip col={hoveredCol} />}
      </main>
    );
  }

  return (
    <main
      style={{
        fontFamily: 'sans-serif',
        maxWidth: 900,
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
            marginTop: 12,
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
