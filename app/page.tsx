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

type ResultItem = CargoItem & {
  cbm: number;
  totalWeight: number;
  placement: string;
};

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
  const [results, setResults] = useState<ResultItem[]>([]);

  const addCargo = () => {
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
  };

  const removeCargo = (id: number) =>
    setCargos(cargos.filter((c) => c.id !== id));

  const updateCargo = (id: number, field: keyof CargoItem, value: any) => {
    setCargos(cargos.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const calcCbm = (c: CargoItem) =>
    (c.length / 100) * (c.width / 100) * (c.height / 100) * c.quantity;

  const totalCbm = cargos.reduce((sum, c) => sum + calcCbm(c), 0);
  const totalWeight = cargos.reduce((sum, c) => sum + c.weight * c.quantity, 0);
  const loadRate = ((totalCbm / selectedContainer.maxCbm) * 100).toFixed(1);

  // 계산하기
  const calculate = () => {
    const sorted = [...cargos].sort((a, b) => {
      if (a.noStack !== b.noStack) return a.noStack ? -1 : 1; // 다단불가 먼저
      return b.weight - a.weight; // 무거운 것 먼저
    });

    const resultItems: ResultItem[] = sorted.map((c) => ({
      ...c,
      cbm: calcCbm(c),
      totalWeight: c.weight * c.quantity,
      placement: c.noStack ? '바닥 1단 (다단 불가)' : '다단 적재 가능',
    }));

    setResults(resultItems);
    setPage('result');
  };

  if (page === 'result') {
    const neededContainers = Math.ceil(totalCbm / selectedContainer.maxCbm);
    const weightRate = (
      (totalWeight / selectedContainer.maxWeight) *
      100
    ).toFixed(1);

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
            marginBottom: 20,
          }}
        >
          {[
            {
              label: '적재율',
              value: `${loadRate}%`,
              color: Number(loadRate) > 100 ? '#e04040' : '#38a169',
              sub: `${totalCbm.toFixed(2)} / ${selectedContainer.maxCbm} CBM`,
            },
            {
              label: '필요 컨테이너',
              value: `${neededContainers}개`,
              color: '#1a1a2e',
              sub: `${selectedContainer.name} 기준`,
            },
            {
              label: '중량 사용률',
              value: `${weightRate}%`,
              color: Number(weightRate) > 100 ? '#e04040' : '#e07b30',
              sub: `${totalWeight.toLocaleString()} / ${selectedContainer.maxWeight.toLocaleString()} kg`,
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

        {/* 2D 배치도 */}
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
            2D 배치도 (상면도)
          </div>
          <div
            style={{
              background: '#eef4ff',
              border: '3px solid #4f8ef7',
              borderRadius: 8,
              padding: 12,
              minHeight: 180,
              display: 'flex',
              flexWrap: 'wrap',
              alignContent: 'flex-end',
              gap: 6,
              position: 'relative',
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
              {selectedContainer.name}
            </div>
            {results.map((c, i) => {
              const colors = [
                '#4f8ef7',
                '#38a169',
                '#e07b30',
                '#6a5acd',
                '#e04040',
                '#0891b2',
              ];
              const color = colors[i % colors.length];
              const widthPx = Math.max(60, Math.min(160, c.cbm * 12));
              const heightPx = c.noStack ? 70 : 110;
              return (
                <div
                  key={c.id}
                  style={{
                    background: color,
                    borderRadius: 6,
                    width: widthPx,
                    height: heightPx,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 10,
                    fontWeight: 700,
                    textAlign: 'center',
                    padding: 4,
                    position: 'relative',
                  }}
                >
                  {c.noStack && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 3,
                        right: 3,
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
                  <div>{c.name || `화물 ${i + 1}`}</div>
                  <div style={{ fontSize: 9, opacity: 0.85 }}>
                    ×{c.quantity}
                  </div>
                </div>
              );
            })}
            {totalCbm < selectedContainer.maxCbm && (
              <div
                style={{
                  background: '#dde4f0',
                  borderRadius: 6,
                  flex: 1,
                  minWidth: 60,
                  height: 90,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#aaa',
                  fontSize: 11,
                }}
              >
                빈 공간
              </div>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginTop: 12,
              flexWrap: 'wrap',
            }}
          >
            {results.map((c, i) => {
              const colors = [
                '#4f8ef7',
                '#38a169',
                '#e07b30',
                '#6a5acd',
                '#e04040',
                '#0891b2',
              ];
              return (
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
                      background: colors[i % colors.length],
                    }}
                  />
                  {c.name || `화물 ${i + 1}`}
                </div>
              );
            })}
          </div>
        </div>

        {/* 품목별 결과 테이블 */}
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
                    '배치',
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
                {results.map((c) => (
                  <tr key={c.id}>
                    <td style={{ padding: '10px', fontWeight: 600 }}>
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
                      {c.cbm.toFixed(3)}
                    </td>
                    <td style={{ padding: '10px' }}>
                      {c.totalWeight.toLocaleString()}
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
                    <td style={{ padding: '10px', color: '#666' }}>
                      {c.placement}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 버튼 */}
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
            { label: '최대 용적', value: `${selectedContainer.maxCbm} CBM` },
            {
              label: '최대 중량',
              value: `${selectedContainer.maxWeight.toLocaleString()} kg`,
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
            적재율:{' '}
            <strong
              style={{ color: Number(loadRate) > 100 ? '#e04040' : '#38a169' }}
            >
              {loadRate}%
            </strong>
            {Number(loadRate) > 100 && (
              <span style={{ color: '#e04040', marginLeft: 6 }}>⚠️ 초과!</span>
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
