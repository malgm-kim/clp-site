'use client';

import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';

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
  noTopLoad: boolean;
};

type PlacedBox3D = {
  cargoId: number;
  cargoName: string;
  color: string;
  x: number;
  y: number;
  z: number;
  l: number;
  w: number;
  h: number;
  weight: number;
  noStack: boolean;
  noTopLoad: boolean;
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

type ClpRecord = {
  id: string;
  created_at: string;
  title: string;
  cargos: CargoItem[];
  total_cbm: number;
  total_weight: number;
  container_count: number;
  container_types: string[];
};

type User = { id: string; email: string };

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

function getHorizontalRotations(
  l: number,
  w: number,
  h: number
): [number, number, number][] {
  const r: [number, number, number][] = [[l, w, h]];
  if (l !== w) r.push([w, l, h]);
  return r;
}

function overlapsXY(
  ax: number,
  ay: number,
  al: number,
  aw: number,
  bx: number,
  by: number,
  bl: number,
  bw: number
): boolean {
  return ax < bx + bl && ax + al > bx && ay < by + bw && ay + aw > by;
}

function calcSupportArea(
  boxes: PlacedBox3D[],
  x: number,
  y: number,
  z: number,
  l: number,
  w: number
): number {
  let area = 0;
  for (const b of boxes) {
    if (Math.abs(b.z + b.h - z) > 0.1) continue;
    const ox = Math.max(x, b.x),
      oy = Math.max(y, b.y);
    const ex = Math.min(x + l, b.x + b.l),
      ey = Math.min(y + w, b.y + b.w);
    if (ex > ox && ey > oy) area += (ex - ox) * (ey - oy);
  }
  return area;
}

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
  noTopLoad: boolean,
  weight: number
): boolean {
  if (x + l > cL || y + w > cW || z + h > cH) return false;
  if (x < 0 || y < 0 || z < 0) return false;
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
  if (noStack && z > 0) return false;
  if (z === 0) return true;
  if (calcSupportArea(boxes, x, y, z, l, w) < l * w * 0.3) return false;
  for (const b of boxes) {
    if (
      (b.noStack || b.noTopLoad) &&
      overlapsXY(x, y, l, w, b.x, b.y, b.l, b.w) &&
      Math.abs(b.z + b.h - z) < 0.1
    )
      return false;
  }
  for (const b of boxes) {
    if (!overlapsXY(x, y, l, w, b.x, b.y, b.l, b.w)) continue;
    if (Math.abs(b.z + b.h - z) > 0.1) continue;
    const alreadyOn = boxes
      .filter(
        (ob) =>
          overlapsXY(ob.x, ob.y, ob.l, ob.w, b.x, b.y, b.l, b.w) &&
          ob.z >= b.z + b.h
      )
      .reduce((s, ob) => s + ob.weight, 0);
    if (alreadyOn + weight > b.weight) return false;
  }
  return true;
}

function getExtremePoints(
  boxes: PlacedBox3D[],
  cL: number,
  cW: number,
  cH: number
) {
  const pts = new Set<string>();
  const add = (x: number, y: number, z: number) => {
    if (x >= 0 && y >= 0 && z >= 0 && x < cL && y < cW && z < cH)
      pts.add(`${Math.round(x)},${Math.round(y)},${Math.round(z)}`);
  };
  add(0, 0, 0);
  for (const b of boxes) {
    add(b.x + b.l, b.y, b.z);
    add(b.x, b.y + b.w, b.z);
    add(b.x, b.y, b.z + b.h);
    add(b.x + b.l, b.y + b.w, b.z);
    add(b.x + b.l, b.y, b.z + b.h);
    add(b.x, b.y + b.w, b.z + b.h);
    add(b.x + b.l, b.y + b.w, b.z + b.h);
    for (const o of boxes) {
      if (o === b) continue;
      add(b.x + b.l, o.y, b.z);
      add(b.x + b.l, o.y + o.w, b.z);
      add(b.x + b.l, o.y, b.z + b.h);
      add(b.x, b.y + b.w, o.z);
      add(b.x + b.l, b.y + b.w, o.z);
      add(b.x, b.y + b.w, o.z + o.h);
      add(b.x, o.y, b.z + b.h);
      add(b.x + b.l, o.y, b.z + b.h);
      add(b.x, o.y + o.w, b.z + b.h);
    }
  }
  return Array.from(pts)
    .map((s) => {
      const [x, y, z] = s.split(',').map(Number);
      return { x, y, z };
    })
    .sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
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

function pack3D(
  cargoList: CargoItem[],
  cargos: CargoItem[],
  ct: (typeof CONTAINER_TYPES)[number]
): { boxes: PlacedBox3D[]; remaining: CargoItem[] } {
  const placed: PlacedBox3D[] = [],
    remaining: CargoItem[] = [];
  for (const cargo of cargoList) {
    const colorIdx = cargos.findIndex((c) => c.id === cargo.id);
    const color = COLORS[colorIdx % COLORS.length];
    const rotations = getHorizontalRotations(
      cargo.length,
      cargo.width,
      cargo.height
    );
    const eps = getExtremePoints(placed, ct.length, ct.width, ct.height);
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
            cargo.noTopLoad,
            cargo.weight
          )
        )
          continue;
        const score = ep.z * 10000 + ep.x * 100 + ep.y;
        if (!best || score < best.score)
          best = { x: ep.x, y: ep.y, z: ep.z, l: rl, w: rw, h: rh, score };
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
        noTopLoad: cargo.noTopLoad,
      });
    } else {
      remaining.push(cargo);
    }
  }
  return { boxes: placed, remaining };
}

function buildContainerLoads(cargos: CargoItem[]): ContainerLoad3D[] {
  const ct20GP = CONTAINER_TYPES.find((ct) => ct.name === '20GP')!;
  const ct40HQ = CONTAINER_TYPES.find((ct) => ct.name === '40HQ')!;
  const strategies = [
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return z.length * z.width - a.length * a.width;
      }),
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return z.length * z.width * z.height - a.length * a.width * a.height;
      }),
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return z.height - a.height;
      }),
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return a.length * a.width * a.height - z.length * z.width * z.height;
      }),
    (b: CargoItem[]) =>
      [...b].sort((a, z) => {
        if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
        return Math.max(z.length, z.width) - Math.max(a.length, a.width);
      }),
  ];
  const runPacking = (
    strategy: (b: CargoItem[]) => CargoItem[]
  ): ContainerLoad3D[] => {
    let remaining = [...cargos].flatMap((c) =>
      Array.from({ length: c.quantity }, () => ({ ...c, quantity: 1 }))
    );
    const loads: ContainerLoad3D[] = [];
    let containerId = 0,
      safety = 0;
    while (remaining.length > 0 && safety < 50) {
      safety++;
      const totalCbm = remaining.reduce(
        (s, c) => s + (c.length / 100) * (c.width / 100) * (c.height / 100),
        0
      );
      const totalWeight = remaining.reduce((s, c) => s + c.weight, 0);
      const selectedCt =
        totalCbm <= ct20GP.maxCbm * 0.92 && totalWeight <= ct20GP.maxWeight
          ? ct20GP
          : ct40HQ;
      const { boxes, remaining: leftover } = pack3D(
        strategy(remaining),
        cargos,
        selectedCt
      );
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
  };
  let best: ContainerLoad3D[] | null = null;
  for (const s of strategies) {
    const r = runPacking(s);
    if (!best || r.length < best.length) best = r;
    if (best.length === 1) break;
  }
  return best!.map((load, i) => ({ ...load, containerId: i }));
}

// ✅ AuthModal을 Home 밖으로 분리
type AuthModalProps = {
  authMode: 'login' | 'signup';
  email: string;
  password: string;
  authError: string;
  authLoading: boolean;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  setAuthMode: (v: 'login' | 'signup') => void;
  setAuthError: (v: string) => void;
  setShowAuth: (v: boolean) => void;
  handleLogin: () => void;
  handleSignup: () => void;
};

function AuthModal({
  authMode,
  email,
  password,
  authError,
  authLoading,
  setEmail,
  setPassword,
  setAuthMode,
  setAuthError,
  setShowAuth,
  handleLogin,
  handleSignup,
}: AuthModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 16,
          padding: 32,
          width: 360,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
          {authMode === 'login' ? '🔐 로그인' : '📝 회원가입'}
        </h2>
        <p style={{ fontSize: 12, color: '#aaa', marginBottom: 24 }}>
          CLP 기록을 저장하고 불러올 수 있어요
        </p>
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#555',
              display: 'block',
              marginBottom: 4,
            }}
          >
            이메일
          </label>
          <input
            id="auth-email"
            name="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #ddd',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#555',
              display: 'block',
              marginBottom: 4,
            }}
          >
            비밀번호
          </label>
          <input
            id="auth-password"
            name="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="6자리 이상"
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              (authMode === 'login' ? handleLogin() : handleSignup())
            }
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #ddd',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        {authError && (
          <div
            style={{
              background: '#fff0f0',
              color: '#e04040',
              fontSize: 12,
              padding: '8px 12px',
              borderRadius: 8,
              marginBottom: 12,
            }}
          >
            {authError}
          </div>
        )}
        <button
          onClick={authMode === 'login' ? handleLogin : handleSignup}
          disabled={authLoading}
          style={{
            width: '100%',
            padding: 12,
            borderRadius: 8,
            border: 'none',
            background: '#4f8ef7',
            color: 'white',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          {authLoading
            ? '처리중...'
            : authMode === 'login'
            ? '로그인'
            : '회원가입'}
        </button>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <button
            onClick={() => {
              setAuthMode(authMode === 'login' ? 'signup' : 'login');
              setAuthError('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#4f8ef7',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {authMode === 'login'
              ? '계정이 없으신가요? 회원가입'
              : '이미 계정이 있으신가요? 로그인'}
          </button>
          <button
            onClick={() => {
              setShowAuth(false);
              setAuthError('');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#aaa',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ✅ RecordsModal을 Home 밖으로 분리
type RecordsModalProps = {
  records: ClpRecord[];
  setShowRecords: (v: boolean) => void;
  loadRecord: (r: ClpRecord) => void;
  deleteRecord: (id: string) => void;
};

function RecordsModal({
  records,
  setShowRecords,
  loadRecord,
  deleteRecord,
}: RecordsModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 16,
          padding: 28,
          width: 560,
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>📋 내 CLP 기록</h2>
          <button
            onClick={() => setShowRecords(false)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: '#aaa',
            }}
          >
            ✕
          </button>
        </div>
        {records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
            저장된 기록이 없어요
          </div>
        ) : (
          records.map((r) => (
            <div
              key={r.id}
              style={{
                border: '1px solid #eee',
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <div>
                  <div
                    style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}
                  >
                    {r.title}
                  </div>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    {new Date(r.created_at).toLocaleDateString('ko-KR')}{' '}
                    &nbsp;·&nbsp; 컨테이너 {r.container_count}개 &nbsp;·&nbsp;
                    {r.total_cbm?.toFixed(2)} CBM &nbsp;·&nbsp;
                    {r.container_types?.join(', ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => loadRecord(r)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 6,
                      border: '1px solid #4f8ef7',
                      background: 'white',
                      color: '#4f8ef7',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    불러오기
                  </button>
                  <button
                    onClick={() => deleteRecord(r.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid #e04040',
                      background: 'white',
                      color: '#e04040',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    삭제
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [records, setRecords] = useState<ClpRecord[]>([]);
  const [showRecords, setShowRecords] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
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
      noTopLoad: false,
    },
  ]);
  const [page, setPage] = useState<'input' | 'result'>('input');
  const [containerLoads, setContainerLoads] = useState<ContainerLoad3D[]>([]);
  const [hoveredBox, setHoveredBox] = useState<PlacedBox3D | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user)
        setUser({ id: session.user.id, email: session.user.email! });
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.user)
        setUser({ id: session.user.id, email: session.user.email! });
      else setUser(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) setAuthError(error.message);
    else setShowAuth(false);
    setAuthLoading(false);
  };

  const handleSignup = async () => {
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setAuthError(error.message);
    else setAuthError('이메일을 확인해주세요! 인증 후 로그인 가능합니다.');
    setAuthLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const handleSave = async () => {
    if (!user) {
      setShowAuth(true);
      return;
    }
    setSaving(true);
    const totalCbm = cargos.reduce(
      (s, c) =>
        s + (c.length / 100) * (c.width / 100) * (c.height / 100) * c.quantity,
      0
    );
    const totalWeight = cargos.reduce((s, c) => s + c.weight * c.quantity, 0);
    const { error } = await supabase.from('clp_records').insert({
      user_id: user.id,
      title: saveTitle || `CLP ${new Date().toLocaleDateString('ko-KR')}`,
      cargos,
      results: containerLoads,
      total_cbm: totalCbm,
      total_weight: totalWeight,
      container_count: containerLoads.length,
      container_types: Array.from(
        new Set(containerLoads.map((l) => l.containerType.name))
      ),
    });
    if (!error) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
    setSaving(false);
  };

  const loadRecords = async () => {
    if (!user) {
      setShowAuth(true);
      return;
    }
    const { data } = await supabase
      .from('clp_records')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setRecords(data);
    setShowRecords(true);
  };

  const loadRecord = (record: ClpRecord) => {
    setCargos(record.cargos);
    setShowRecords(false);
    setPage('input');
  };
  const deleteRecord = async (id: string) => {
    await supabase.from('clp_records').delete().eq('id', id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

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
        noTopLoad: false,
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
        noTopLoad: false,
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
        noTopLoad: false,
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

  const calculate = async () => {
    setCalculating(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = buildContainerLoads(cargos);
    setContainerLoads(result);
    setCalculating(false);
    setPage('result');
  };

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
          <div style={{ color: '#ffcccc', fontSize: 11 }}>❌ 완전 다단불가</div>
        )}
        {box.noTopLoad && (
          <div style={{ color: '#ffcccc', fontSize: 11 }}>
            ⚠️ 상단 적재 금지
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#666' }}>
        <div>
          위치: X={box.x}cm / Y={box.y}cm / Z={box.z}cm
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
    const DL = 660,
      DW = 180,
      DH = 120;
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
              📊 적재 계산 결과
            </h1>
            <p style={{ color: '#888' }}>
              3D Extreme Points · 바닥면 고정 회전 · 자동 컨테이너 선택
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {user ? (
              <>
                <span style={{ fontSize: 12, color: '#888' }}>
                  {user.email}
                </span>
                <button
                  onClick={loadRecords}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #4f8ef7',
                    background: 'white',
                    color: '#4f8ef7',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  📋 내 기록
                </button>
                <button
                  onClick={handleLogout}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #ddd',
                    background: 'white',
                    color: '#888',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  로그아웃
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#4f8ef7',
                  color: 'white',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🔐 로그인
              </button>
            )}
          </div>
        </div>

        {user && (
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <input
              id="saveTitle"
              name="saveTitle"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="저장할 CLP 이름 (선택사항)"
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #ddd',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                background: saveSuccess ? '#38a169' : '#4f8ef7',
                color: 'white',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {saving
                ? '저장 중...'
                : saveSuccess
                ? '✅ 저장됨'
                : '💾 저장하기'}
            </button>
          </div>
        )}

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
              <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
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
                    {[...load.boxes]
                      .sort((a, b) => a.z - b.z)
                      .map((box, bi) => {
                        const isHovered = hoveredBox === box;
                        const px = box.x * scaleL,
                          py = box.y * scaleW;
                        const pw = box.l * scaleL,
                          ph = box.w * scaleW;
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
                            {box.noTopLoad && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 1,
                                  left: 1,
                                  background: '#fff7e6',
                                  color: '#d97706',
                                  fontSize: 5,
                                  padding: '0 2px',
                                  borderRadius: 1,
                                  fontWeight: 800,
                                }}
                              >
                                NT
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
                        const pz = (ct.height - box.z - box.h) * scaleH;
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
                              height: Math.max(ph, 1),
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
              <div style={{ fontSize: 10, color: '#aaa' }}>
                💡 박스에 마우스를 올리면 상세 정보 · NO: 완전다단불가 · NT:
                상단적재
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
                    '적재옵션',
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
                      {c.noStack ? (
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            background: '#fff0f0',
                            color: '#e04040',
                          }}
                        >
                          ❌ 완전 다단불가
                        </span>
                      ) : c.noTopLoad ? (
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            background: '#fff7e6',
                            color: '#d97706',
                          }}
                        >
                          ⚠️ 상단 적재 금지
                        </span>
                      ) : (
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            background: '#f0fff4',
                            color: '#38a169',
                          }}
                        >
                          ✅ 가능
                        </span>
                      )}
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
        {showAuth && (
          <AuthModal
            authMode={authMode}
            email={email}
            password={password}
            authError={authError}
            authLoading={authLoading}
            setEmail={setEmail}
            setPassword={setPassword}
            setAuthMode={setAuthMode}
            setAuthError={setAuthError}
            setShowAuth={setShowAuth}
            handleLogin={handleLogin}
            handleSignup={handleSignup}
          />
        )}
        {showRecords && (
          <RecordsModal
            records={records}
            setShowRecords={setShowRecords}
            loadRecord={loadRecord}
            deleteRecord={deleteRecord}
          />
        )}
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
            🚢 Container Load Plan
          </h1>
          <p style={{ color: '#888' }}>
            화물을 입력하면 최적 컨테이너를 자동으로 선택해드립니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {user ? (
            <>
              <span style={{ fontSize: 12, color: '#888' }}>{user.email}</span>
              <button
                onClick={loadRecords}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #4f8ef7',
                  background: 'white',
                  color: '#4f8ef7',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                📋 내 기록
              </button>
              <button
                onClick={handleLogout}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  background: 'white',
                  color: '#888',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                로그아웃
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: '#4f8ef7',
                color: 'white',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🔐 로그인 / 회원가입
            </button>
          )}
          <div style={{ fontWeight: 'bold', fontSize: 14, color: '#555' }}>
            MADE BY ZERO
          </div>
        </div>
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
          20GP 1개에 들어가면 20GP, 나머지는 40HQ를 사용합니다.
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
              <strong>{ct.name}</strong>&nbsp;
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
            id="quickInput"
            name="quickInput"
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
                  '상단적재',
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
                      id={`name-${c.id}`}
                      name={`name-${c.id}`}
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
                        id={`${field}-${c.id}`}
                        name={`${field}-${c.id}`}
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
                      onChange={(e) => {
                        setCargos((prev) =>
                          prev.map((item) =>
                            item.id === c.id
                              ? {
                                  ...item,
                                  noStack: e.target.checked,
                                  noTopLoad: e.target.checked
                                    ? false
                                    : item.noTopLoad,
                                }
                              : item
                          )
                        );
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={c.noTopLoad}
                      onChange={(e) => {
                        setCargos((prev) =>
                          prev.map((item) =>
                            item.id === c.id
                              ? {
                                  ...item,
                                  noTopLoad: e.target.checked,
                                  noStack: e.target.checked
                                    ? false
                                    : item.noStack,
                                }
                              : item
                          )
                        );
                      }}
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
          💡 다단불가: 바닥에만 배치, 위에도 못 올림 &nbsp;|&nbsp; 상단적재:
          쌓일 수 있지만 위에는 못 올림
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
        disabled={calculating}
        style={{
          width: '100%',
          padding: 14,
          borderRadius: 8,
          border: 'none',
          background: calculating ? '#93c5fd' : '#4f8ef7',
          color: 'white',
          fontWeight: 700,
          fontSize: 15,
          cursor: calculating ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {calculating
          ? '⏳ 최적 배치 계산 중... (잠시만 기다려주세요)'
          : '🔍 최적 적재 계산하기'}
      </button>

      {showAuth && (
        <AuthModal
          authMode={authMode}
          email={email}
          password={password}
          authError={authError}
          authLoading={authLoading}
          setEmail={setEmail}
          setPassword={setPassword}
          setAuthMode={setAuthMode}
          setAuthError={setAuthError}
          setShowAuth={setShowAuth}
          handleLogin={handleLogin}
          handleSignup={handleSignup}
        />
      )}
      {showRecords && (
        <RecordsModal
          records={records}
          setShowRecords={setShowRecords}
          loadRecord={loadRecord}
          deleteRecord={deleteRecord}
        />
      )}
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
