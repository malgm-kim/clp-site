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
  noStack: boolean; // 완전 다단불가: 바닥에만, 위에도 못 올림
  noTopLoad: boolean; // 상단적재: 쌓일 수 있지만 위에는 못 올림
  stackGroup?: string; // 자체다단: 같은 값끼리만 쌓기 가능
  groupId?: number;
  highlighted?: boolean;
  parseError?: boolean;
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
  stackGroup?: string;
  groupId?: number;
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
  results: ContainerLoad3D[];
  total_cbm: number;
  total_weight: number;
  container_count: number;
  container_types: string[];
};

type User = { id: string; email: string };

const COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
];

const theme = {
  bg: '#f5f5f4',
  card: '#ffffff',
  primary: '#44403c',
  primaryLight: '#f5f5f4',
  success: '#4d7c60',
  warning: '#92724a',
  danger: '#9f4b4b',
  text: '#1c1917',
  textSecondary: '#57534e',
  textMuted: '#a8a29e',
  border: '#e7e5e4',
  shadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.04)',
  shadowLg: '0 4px 6px rgba(0,0,0,0.04), 0 20px 40px rgba(0,0,0,0.07)',
};

const EMPTY_CARGO = (): CargoItem => ({
  id: Date.now() + Math.random(),
  name: '',
  length: 0,
  width: 0,
  height: 0,
  weight: 0,
  quantity: 1,
  noStack: false,
  noTopLoad: false,
  stackGroup: '',
});

// ── 알고리즘 ────────────────────────────────────────────

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
  weight: number,
  stackGroup?: string
): boolean {
  // 컨테이너 범위 체크
  if (x + l > cL || y + w > cW || z + h > cH || x < 0 || y < 0 || z < 0)
    return false;

  // 다른 박스와 겹침 체크
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

  // 완전 다단불가: 반드시 바닥(z=0)에만
  if (noStack && z > 0) return false;

  // 바닥이면 추가 체크 불필요
  if (z === 0) return true;

  // 지지면 체크
  if (calcSupportArea(boxes, x, y, z, l, w) < l * w * 0.05) return false;

  // 아래 박스들 체크
  for (const b of boxes) {
    if (!overlapsXY(x, y, l, w, b.x, b.y, b.l, b.w)) continue;
    if (Math.abs(b.z + b.h - z) > 0.1) continue;

    // ✅ 완전 다단불가 박스 위에는 못 올림
    if (b.noStack) return false;

    // ✅ 상단적재 체크된 박스 위에는 못 올림
    if (b.noTopLoad) return false;

    // ✅ 자체다단 체크: 그룹이 다르면 못 올림
    if (stackGroup || b.stackGroup) {
      if (stackGroup !== b.stackGroup) return false;
    }

    // 하중 체크
    if (b.weight > 0) {
      const alreadyOn = boxes
        .filter(
          (ob) =>
            overlapsXY(ob.x, ob.y, ob.l, ob.w, b.x, b.y, b.l, b.w) &&
            ob.z >= b.z + b.h
        )
        .reduce((s, ob) => s + ob.weight, 0);
      if (alreadyOn + weight > b.weight) return false;
    }
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
  const sorted = [...cargoList].sort((a, b) => {
    if (a.groupId && b.groupId) {
      if (a.groupId === b.groupId) return 0;
      return a.groupId - b.groupId;
    }
    if (a.groupId) return -1;
    if (b.groupId) return 1;
    return 0;
  });
  for (const cargo of sorted) {
    const colorIdx = cargos.findIndex((c) => c.id === cargo.id);
    const color = COLORS[colorIdx % COLORS.length];
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
      for (const [rl, rw, rh] of getHorizontalRotations(
        cargo.length,
        cargo.width,
        cargo.height
      )) {
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
            cargo.weight,
            cargo.stackGroup
          )
        )
          continue;
        let score = ep.z * 10000 + ep.x * 100 + ep.y;
        if (cargo.groupId) {
          const gBoxes = placed.filter((b) => b.groupId === cargo.groupId);
          if (gBoxes.length > 0) {
            const avgX = gBoxes.reduce((s, b) => s + b.x, 0) / gBoxes.length;
            const avgY = gBoxes.reduce((s, b) => s + b.y, 0) / gBoxes.length;
            const dist = Math.sqrt(
              Math.pow(ep.x - avgX, 2) + Math.pow(ep.y - avgY, 2)
            );
            score -= Math.max(0, 500 - dist);
          }
        }
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
        stackGroup: cargo.stackGroup,
        groupId: cargo.groupId,
      });
    } else {
      remaining.push(cargo);
    }
  }
  return { boxes: placed, remaining };
}

const STRATEGIES = [
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
  (b: CargoItem[]) =>
    [...b].sort((a, z) => {
      if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
      return a.height - z.height;
    }),
  (b: CargoItem[]) =>
    [...b].sort((a, z) => {
      if (a.noStack !== z.noStack) return a.noStack ? -1 : 1;
      return z.width - a.width;
    }),
];

function buildContainerLoads(cargos: CargoItem[]): ContainerLoad3D[] {
  const ct20GP = CONTAINER_TYPES.find((ct) => ct.name === '20GP')!;
  const ct40HQ = CONTAINER_TYPES.find((ct) => ct.name === '40HQ')!;
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
      const fitsIn20GP =
        totalCbm <= ct20GP.maxCbm * 0.92 && totalWeight <= ct20GP.maxWeight;
      const selectedCt = fitsIn20GP ? ct20GP : ct40HQ;
      const { boxes, remaining: leftover } = pack3D(
        strategy(remaining),
        cargos,
        selectedCt
      );
      if (fitsIn20GP && leftover.length > 0) {
        const { boxes: b40, remaining: l40 } = pack3D(
          strategy(remaining),
          cargos,
          ct40HQ
        );
        if (b40.length > 0 && l40.length < leftover.length) {
          const cog = calcCOG(b40, ct40HQ.length, ct40HQ.width);
          loads.push({
            containerId: containerId++,
            containerType: ct40HQ,
            boxes: b40,
            cogX: cog.x,
            cogY: cog.y,
            xImbalance: Math.abs(cog.x - 0.5) > 0.1,
            yImbalance: Math.abs(cog.y - 0.5) > 0.1,
          });
          remaining = l40;
          continue;
        }
      }
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
  for (const s of STRATEGIES) {
    const r = runPacking(s);
    if (!best || r.length < best.length) best = r;
    if (best.length === 1) break;
  }
  return best!.map((load, i) => ({ ...load, containerId: i }));
}

// ── 공통 컴포넌트 ───────────────────────────────────────

function Nav({
  user,
  onLogin,
  onLogout,
  onRecords,
  onBack,
}: {
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
  onRecords: () => void;
  onBack?: () => void;
}) {
  return (
    <nav
      style={{
        background: 'white',
        borderBottom: `1px solid ${theme.border}`,
        padding: '0 32px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 1px 0 rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            background: 'linear-gradient(135deg,#44403c,#57534e)',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
          }}
        >
          🚢
        </div>
        <span style={{ fontWeight: 800, fontSize: 16, color: theme.text }}>
          CLP Studio
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {user ? (
          <>
            <span
              style={{
                fontSize: 13,
                color: theme.textSecondary,
                background: theme.bg,
                padding: '6px 12px',
                borderRadius: 8,
              }}
            >
              👤 {user.email?.replace('@clp.app', '')}
            </span>
            <button onClick={onRecords} style={navBtnStyle}>
              📋 내 기록
            </button>
            <button
              onClick={onLogout}
              style={{
                ...navBtnStyle,
                border: `1px solid ${theme.border}`,
                background: 'white',
                color: theme.textSecondary,
              }}
            >
              로그아웃
            </button>
          </>
        ) : (
          <button
            onClick={onLogin}
            style={{
              padding: '8px 18px',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg,#44403c,#57534e)',
              color: 'white',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            🔐 {onBack ? '로그인' : '로그인 / 회원가입'}
          </button>
        )}
        {onBack && (
          <button
            onClick={onBack}
            style={{
              ...navBtnStyle,
              border: `1px solid ${theme.border}`,
              background: 'white',
              color: theme.textSecondary,
            }}
          >
            ← 다시 입력
          </button>
        )}
        {!onBack && (
          <div
            style={{
              fontWeight: 800,
              fontSize: 13,
              color: theme.textMuted,
              background: theme.bg,
              padding: '6px 12px',
              borderRadius: 8,
            }}
          >
            MADE BY ZERO
          </div>
        )}
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '32px 24px',
        borderTop: `1px solid ${theme.border}`,
        marginTop: 40,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 24,
          fontSize: 13,
          color: theme.textMuted,
        }}
      >
        <a
          href="/privacy"
          style={{ color: theme.textMuted, textDecoration: 'none' }}
        >
          개인정보처리방침
        </a>
        <span>·</span>
        <span>© 2025 CLP Studio. MADE BY ZERO</span>
        <span>·</span>
        <a
          href="https://clp-site.vercel.app"
          style={{ color: theme.textMuted, textDecoration: 'none' }}
        >
          clp-site.vercel.app
        </a>
      </div>
    </div>
  );
}

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
        background: 'rgba(15,23,42,0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 24,
          padding: 40,
          width: 400,
          boxShadow: theme.shadowLg,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 48,
              height: 48,
              background: 'linear-gradient(135deg,#44403c,#57534e)',
              borderRadius: 16,
              margin: '0 auto 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
            }}
          >
            🚢
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: theme.text,
              marginBottom: 6,
            }}
          >
            {authMode === 'login' ? '다시 만나요!' : '시작해볼까요?'}
          </h2>
          <p style={{ fontSize: 13, color: theme.textMuted }}>
            {authMode === 'login'
              ? '아이디와 비밀번호로 로그인하세요'
              : '아이디를 만들고 CLP를 저장하세요'}
          </p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: theme.textSecondary,
              display: 'block',
              marginBottom: 6,
            }}
          >
            아이디
          </label>
          <input
            id="auth-email"
            name="auth-email"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="아이디 입력 (3자 이상)"
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 12,
              border: `1.5px solid ${theme.border}`,
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => (e.target.style.borderColor = theme.primary)}
            onBlur={(e) => (e.target.style.borderColor = theme.border)}
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: theme.textSecondary,
              display: 'block',
              marginBottom: 6,
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
              padding: '12px 14px',
              borderRadius: 12,
              border: `1.5px solid ${theme.border}`,
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => (e.target.style.borderColor = theme.primary)}
            onBlur={(e) => (e.target.style.borderColor = theme.border)}
          />
        </div>
        {authError && (
          <div
            style={{
              background: '#fef2f2',
              color: theme.danger,
              fontSize: 12,
              padding: '10px 14px',
              borderRadius: 10,
              marginBottom: 16,
              border: '1px solid #fecaca',
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
            padding: 14,
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg,#44403c,#57534e)',
            color: 'white',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
            marginBottom: 16,
            fontFamily: 'inherit',
          }}
        >
          {authLoading
            ? '처리 중...'
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
              color: theme.primary,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600,
              fontFamily: 'inherit',
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
              color: theme.textMuted,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

type RecordsModalProps = {
  records: ClpRecord[];
  setShowRecords: (v: boolean) => void;
  loadRecord: (r: ClpRecord) => void;
  deleteRecord: (id: string) => void;
  duplicateRecord: (r: ClpRecord) => void;
  editingRecord: ClpRecord | null;
  setEditingRecord: (r: ClpRecord | null) => void;
  saveTitle: string;
  setSaveTitle: (v: string) => void;
  updateRecord: (id: string) => void;
  saving: boolean;
  saveSuccess: boolean;
};

function RecordsModal({
  records,
  setShowRecords,
  loadRecord,
  deleteRecord,
  duplicateRecord,
  editingRecord,
  setEditingRecord,
  saveTitle,
  setSaveTitle,
  updateRecord,
  saving,
  saveSuccess,
}: RecordsModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: theme.bg,
          borderRadius: 24,
          padding: 32,
          width: 640,
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: theme.shadowLg,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: theme.text,
                marginBottom: 2,
              }}
            >
              📋 내 CLP 기록
            </h2>
            <p style={{ fontSize: 13, color: theme.textMuted }}>
              총 {records.length}개의 기록
            </p>
          </div>
          <button
            onClick={() => setShowRecords(false)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: theme.border,
              border: 'none',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
        {records.length === 0 ? (
          <div
            style={{ textAlign: 'center', padding: 60, color: theme.textMuted }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 14 }}>저장된 기록이 없어요</div>
          </div>
        ) : (
          records.map((r) => (
            <div
              key={r.id}
              style={{
                background: 'white',
                border: `1.5px solid ${
                  editingRecord?.id === r.id ? theme.primary : theme.border
                }`,
                borderRadius: 16,
                padding: 20,
                marginBottom: 12,
                boxShadow: theme.shadow,
              }}
            >
              {editingRecord?.id === r.id ? (
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: theme.primary,
                      fontWeight: 700,
                      marginBottom: 10,
                    }}
                  >
                    ✏️ 제목 수정
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id={`edit-${r.id}`}
                      name={`edit-${r.id}`}
                      value={saveTitle}
                      onChange={(e) => setSaveTitle(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: `1.5px solid ${theme.primary}`,
                        fontSize: 13,
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                    <button
                      onClick={() => updateRecord(r.id)}
                      disabled={saving}
                      style={{
                        padding: '10px 18px',
                        borderRadius: 10,
                        border: 'none',
                        background: saveSuccess ? theme.success : theme.primary,
                        color: 'white',
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {saving
                        ? '저장 중...'
                        : saveSuccess
                        ? '✅ 저장됨'
                        : '저장'}
                    </button>
                    <button
                      onClick={() => setEditingRecord(null)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: `1px solid ${theme.border}`,
                        background: 'white',
                        color: theme.textSecondary,
                        fontSize: 13,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        color: theme.text,
                        marginBottom: 4,
                      }}
                    >
                      {r.title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: theme.textMuted,
                        display: 'flex',
                        gap: 12,
                      }}
                    >
                      <span>
                        📅 {new Date(r.created_at).toLocaleDateString('ko-KR')}
                      </span>
                      <span>🚢 {r.container_count}개</span>
                      <span>📦 {r.total_cbm?.toFixed(2)} CBM</span>
                      <span>{r.container_types?.join(', ')}</span>
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      marginLeft: 12,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      onClick={() => loadRecord(r)}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: `1.5px solid ${theme.primary}`,
                        background: theme.primaryLight,
                        color: theme.primary,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      불러오기
                    </button>
                    <button
                      onClick={() => {
                        setEditingRecord(r);
                        setSaveTitle(r.title);
                      }}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: `1.5px solid ${theme.success}`,
                        background: '#f0fdf4',
                        color: theme.success,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      수정
                    </button>
                    <button
                      onClick={() => duplicateRecord(r)}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: '1.5px solid #8b5cf6',
                        background: '#f5f3ff',
                        color: '#8b5cf6',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      복제
                    </button>
                    <button
                      onClick={() => deleteRecord(r.id)}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: `1.5px solid ${theme.danger}`,
                        background: '#fef2f2',
                        color: theme.danger,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Home ────────────────────────────────────────────────

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
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [cargos, setCargos] = useState<CargoItem[]>([
    { ...EMPTY_CARGO(), id: 1 },
  ]);
  const [page, setPage] = useState<'input' | 'result'>('input');
  const [containerLoads, setContainerLoads] = useState<ContainerLoad3D[]>([]);
  const [hoveredBox, setHoveredBox] = useState<PlacedBox3D | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [calculating, setCalculating] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ClpRecord | null>(null);

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
    const handlePopState = () => setPage('input');
    window.addEventListener('popstate', handlePopState);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const toEmail = (id: string) => `${id.trim()}@clp.app`;

  const handleLogin = async () => {
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({
      email: toEmail(email),
      password,
    });
    if (error) setAuthError('아이디 또는 비밀번호가 틀렸어요.');
    else setShowAuth(false);
    setAuthLoading(false);
  };

  const handleSignup = async () => {
    if (email.trim().length < 3) {
      setAuthError('아이디는 3자 이상이어야 해요.');
      return;
    }
    if (password.length < 6) {
      setAuthError('비밀번호는 6자 이상이어야 해요.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signUp({
      email: toEmail(email),
      password,
    });
    if (error) setAuthError(error.message);
    else setShowAuth(false);
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

  const updateRecord = async (id: string) => {
    if (!user) return;
    setSaving(true);
    const totalCbm = cargos.reduce(
      (s, c) =>
        s + (c.length / 100) * (c.width / 100) * (c.height / 100) * c.quantity,
      0
    );
    const totalWeight = cargos.reduce((s, c) => s + c.weight * c.quantity, 0);
    const { error } = await supabase
      .from('clp_records')
      .update({
        title: saveTitle,
        cargos,
        results: containerLoads,
        total_cbm: totalCbm,
        total_weight: totalWeight,
        container_count: containerLoads.length,
        container_types: Array.from(
          new Set(containerLoads.map((l) => l.containerType.name))
        ),
      })
      .eq('id', id);
    if (!error) {
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        setEditingRecord(null);
      }, 2000);
    }
    setSaving(false);
  };

  const duplicateRecord = async (record: ClpRecord) => {
    if (!user) return;
    await supabase.from('clp_records').insert({
      user_id: user.id,
      title: `${record.title} (복사본)`,
      cargos: record.cargos,
      results: record.results,
      total_cbm: record.total_cbm,
      total_weight: record.total_weight,
      container_count: record.container_count,
      container_types: record.container_types,
    });
    await loadRecords();
  };
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    let headerIdx = -1;
    let colMap: Record<string, number> = {};
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const rowStr = row.map((c: any) => String(c ?? '').trim());
      if (rowStr.some((c: string) => c === 'Actual Customer')) {
        headerIdx = i;
        rowStr.forEach((c: string, j: number) => {
          if (c === 'Actual Customer') colMap['customer'] = j;
          if (c === 'Qty' && colMap['qty'] === undefined) colMap['qty'] = j;
          if (
            (c === 'Weigth' || c === 'Weight') &&
            colMap['weight'] === undefined
          )
            colMap['weight'] = j;
          if (c === 'Dimension') colMap['dimension'] = j;
          if (c === 'Remark') colMap['remark'] = j;
        });
        break;
      }
    }

    if (headerIdx === -1) {
      alert('헤더를 찾을 수 없어요.');
      return;
    }

    const parseDimension = (
      str: string
    ): { l: number; w: number; h: number; qty: number }[] => {
      if (!str) return [];
      const results: { l: number; w: number; h: number; qty: number }[] = [];
      const pattern =
        /(\d+(?:\.\d+)?)[xX*×]\s*(\d+(?:\.\d+)?)[xX*×]\s*(\d+(?:\.\d+)?)(?:[xX*×]\s*(\d+(?:\.\d+)?))?(?:\s*\([^)]*\))?(?:\((\d+)\))?/g;
      let match;
      while ((match = pattern.exec(str)) !== null) {
        let l = +match[1],
          w = +match[2],
          h = +match[3];
        // 소수점 있으면 M → CM 변환
        if (
          match[1].includes('.') ||
          match[2].includes('.') ||
          match[3].includes('.')
        ) {
          l = Math.round(l * 100);
          w = Math.round(w * 100);
          h = Math.round(h * 100);
        }
        // CBM이 100 초과면 MM → CM 변환
        const cbm = (l / 100) * (w / 100) * (h / 100);
        if (cbm > 100) {
          l = Math.round(l / 10);
          w = Math.round(w / 10);
          h = Math.round(h / 10);
        }
        results.push({ l, w, h, qty: match[5] ? +match[5] : 0 });
      }
      return results;
    };

    const newItems: CargoItem[] = [];
    const groupId = Date.now();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const customer = String(row[colMap['customer']] ?? '').trim();
      if (!customer) continue;

      const bookingQty = Number(row[colMap['qty']] ?? 0) || 1;
      const totalWeight = Number(row[colMap['weight']] ?? 0) || 0;
      const perWeight = Math.round((totalWeight / bookingQty) * 10) / 10;

      const dimStr = String(row[colMap['dimension']] ?? '').trim();
      const remarkStr = String(row[colMap['remark']] ?? '').trim();
      const parseStr = dimStr || remarkStr;

      const dims = parseDimension(parseStr);
      if (dims.length === 0) {
        // 파싱 실패 → 품명만 입력, 빨간 하이라이트
        newItems.push({
          ...EMPTY_CARGO(),
          name: customer,
          weight: perWeight,
          quantity: bookingQty,
          groupId,
          highlighted: true,
          parseError: true,
        });
        continue;
      }

      // (n) 없는 경우: 총 수량을 사이즈 개수로 균등 배분
      const totalDimQty = dims.reduce((s, d) => s + d.qty, 0);
      const noQtyCount = dims.filter((d) => d.qty === 0).length;
      const remainQty = bookingQty - totalDimQty;
      const perDimQty = noQtyCount > 0 ? Math.round(remainQty / noQtyCount) : 0;

      for (const dim of dims) {
        const qty = dim.qty > 0 ? dim.qty : perDimQty || 1;
        newItems.push({
          ...EMPTY_CARGO(),
          name: customer,
          length: dim.l,
          width: dim.w,
          height: dim.h,
          weight: perWeight,
          quantity: qty,
          groupId,
          highlighted: true,
        });
      }
    }

    if (!newItems.length) {
      alert('파싱된 화물 정보가 없어요.');
      return;
    }
    setCargos((prev) => [
      ...prev.map((c) => ({ ...c, highlighted: false })),
      ...newItems,
    ]);
    setTimeout(
      () =>
        setCargos((prev) => prev.map((c) => ({ ...c, highlighted: false }))),
      3000
    );
    e.target.value = '';
  };

  const handleReset = () => {
    setCargos([{ ...EMPTY_CARGO(), id: 1 }]);
    setContainerLoads([]);
    setPage('input');
    setQuickInput('');
    setHoveredBox(null);
  };

  const addCargo = () => setCargos((prev) => [...prev, EMPTY_CARGO()]);
  const removeCargo = (id: number) =>
    setCargos((prev) => prev.filter((c) => c.id !== id));
  const updateCargo = (id: number, field: keyof CargoItem, value: any) =>
    setCargos((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, [field]: value };
        // 파싱 에러 행에서 길이/폭/높이 모두 입력되면 빨간 하이라이트 해제
        if (
          updated.parseError &&
          updated.length > 0 &&
          updated.width > 0 &&
          updated.height > 0 &&
          updated.weight > 0 &&
          updated.quantity > 0
        ) {
          updated.parseError = false;
        }
        return updated;
      })
    );
  const calcCbm = (c: CargoItem) =>
    (c.length / 100) * (c.width / 100) * (c.height / 100) * c.quantity;
  const totalCbm = cargos.reduce((s, c) => s + calcCbm(c), 0);
  const totalWeight = cargos.reduce((s, c) => s + c.weight * c.quantity, 0);

  const handleQuickAdd = async () => {
    if (!quickInput.trim()) return;
    setQuickAddLoading(true);
    const groupId = Date.now();
    const applyItems = (
      parsed: {
        length: number;
        width: number;
        height: number;
        quantity: number;
      }[]
    ) => {
      if (!parsed.length) {
        alert('화물 정보를 찾을 수 없어요');
        return;
      }
      const newItems: CargoItem[] = parsed.map((p) => ({
        ...EMPTY_CARGO(),
        length: p.length || 0,
        width: p.width || 0,
        height: p.height || 0,
        quantity: p.quantity || 1,
        groupId,
        highlighted: true,
      }));
      setCargos((prev) => [
        ...prev.map((c) => ({ ...c, highlighted: false })),
        ...newItems,
      ]);
      setTimeout(
        () =>
          setCargos((prev) => prev.map((c) => ({ ...c, highlighted: false }))),
        3000
      );
      // parseError는 setTimeout으로 해제하지 않음 (사용자가 직접 입력해야 해제)
    };
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: `다음 텍스트에서 화물 치수 정보를 추출해서 JSON 배열만 반환해. 다른 텍스트 절대 쓰지 마.

파싱 규칙:
- W=폭(width), L=길이(length), H=높이(height) 레이블이 있으면 그에 맞게 매핑
- 쉼표가 포함된 숫자는 천단위 구분자임 (예: 1,100 → 1100)
- Pallet, Pallets, EA, BOX, 박스, 개 등은 수량 단위로 인식
- KG, 중량, 적재 관련 텍스트 무시

단위 변환 규칙:
- 숫자가 모두 1000 이상이면 MM → ÷10 해서 CM으로
- 숫자 중 하나라도 소수점이 있으면 M → ×100 해서 CM으로
- 숫자가 100~999 사이면 MM일 가능성 높음 → 실제 물류 박스 크기 기준으로 판단
  (예: 805*920*970 → 실제 박스가 8m×9m×9m일 수 없으므로 MM → 80.5×92×97 CM)
  (예: 120*80*100 → 일반적인 박스 크기이므로 CM 그대로)
- 박스 크기가 비현실적으로 크면 (한 변이 300cm 이상) MM으로 재판단
- 수량 없으면 1
- 키: length, width, height, quantity

입력: ${quickInput}

출력 예시: [{"length":110,"width":110,"height":93,"quantity":3}]`,
            },
          ],
        }),
      });
      const data = await response.json();
      const text = data.content?.[0]?.text || '[]';
      applyItems(JSON.parse(text.replace(/```json|```/g, '').trim()));
    } catch {
      applyItems(parseQuickInput(quickInput));
    } finally {
      setQuickAddLoading(false);
    }
  };

  const parseQuickInput = (text: string) => {
    return text
      .split(/[,\n\/]/)
      .map((item) => {
        let s = item.trim();
        if (!s) return null;
        const isMM = /mm/i.test(s);
        s = s
          .replace(/\d+(\.\d+)?\s*kg/gi, '')
          .toLowerCase()
          .replace(/다단불가|상단적재|노스택|no\s*stack|lwh|mm|ea|kg/gi, ' ')
          .replace(/상단에\s*가벼운\s*짐\s*ok|상단\s*ok|top\s*ok/gi, ' ')
          .replace(/[*×xX\/]/g, ' ')
          .replace(/\((\d+)\)/g, ' $1')
          .replace(/\s+/g, ' ')
          .trim();
        const nums = s.match(/\d+(\.\d+)?/g);
        if (!nums || nums.length < 3) return null;
        let l = +nums[0],
          w = +nums[1],
          h = +nums[2];
        const qty = nums[3] && +nums[3] < 1000 ? +nums[3] : 1;
        if (isMM || l >= 1000 || w >= 1000 || h >= 1000) {
          l = Math.round(l / 10);
          w = Math.round(w / 10);
          h = Math.round(h / 10);
        } else if (l < 10 && w < 10 && h < 10) {
          l = Math.round(l * 100);
          w = Math.round(w * 100);
          h = Math.round(h * 100);
        }
        return { length: l, width: w, height: h, quantity: qty };
      })
      .filter(Boolean) as {
      length: number;
      width: number;
      height: number;
      quantity: number;
    }[];
  };

  const calculate = async () => {
    setCalculating(true);
    await new Promise((r) => setTimeout(r, 50));
    setContainerLoads(buildContainerLoads(cargos));
    setCalculating(false);
    setPage('result');
    window.history.pushState({ page: 'result' }, '', '');
  };

  const calculateDraft = async () => {
    setCalculating(true);
    await new Promise((r) => setTimeout(r, 50));
    const ct20GP = CONTAINER_TYPES.find((ct) => ct.name === '20GP')!;
    const allItems = [...cargos].flatMap((c) =>
      Array.from({ length: c.quantity }, () => ({ ...c, quantity: 1 }))
    );
    let bestBoxes: PlacedBox3D[] = [],
      bestRemaining: CargoItem[] = [];
    for (const strategy of STRATEGIES) {
      const { boxes, remaining } = pack3D(strategy(allItems), cargos, ct20GP);
      if (boxes.length > bestBoxes.length) {
        bestBoxes = boxes;
        bestRemaining = remaining;
      }
    }
    const cog = calcCOG(bestBoxes, ct20GP.length, ct20GP.width);
    setContainerLoads([
      {
        containerId: 0,
        containerType: ct20GP,
        boxes: bestBoxes,
        cogX: cog.x,
        cogY: cog.y,
        xImbalance: Math.abs(cog.x - 0.5) > 0.1,
        yImbalance: Math.abs(cog.y - 0.5) > 0.1,
      },
    ]);
    const remainingGrouped = bestRemaining.reduce((acc, item) => {
      const ex = acc.find((a) => a.id === item.id);
      if (ex) ex.quantity += 1;
      else acc.push({ ...item, quantity: 1 });
      return acc;
    }, [] as CargoItem[]);
    setCargos((prev) =>
      prev
        .map((c) => ({
          ...c,
          quantity: remainingGrouped.find((r) => r.id === c.id)?.quantity || 0,
        }))
        .filter((c) => c.quantity > 0)
    );
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
        borderRadius: 16,
        padding: 16,
        boxShadow: theme.shadowLg,
        zIndex: 1000,
        minWidth: 220,
        pointerEvents: 'none',
        border: `1px solid ${theme.border}`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: theme.primary,
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        박스 정보
      </div>
      <div
        style={{
          background: `linear-gradient(135deg,${box.color}dd,${box.color}aa)`,
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            color: 'white',
            fontSize: 14,
            fontWeight: 700,
            marginBottom: 4,
          }}
        >
          {box.cargoName || '(미입력)'}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
          {box.l}×{box.w}×{box.h}cm
        </div>
        <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
          {box.weight}kg
        </div>
      </div>
      <div style={{ fontSize: 11, color: theme.textSecondary }}>
        <div>
          X:{box.x}cm Y:{box.y}cm Z:{box.z}cm
        </div>
        {box.noStack && (
          <div style={{ color: theme.danger, marginTop: 4, fontWeight: 600 }}>
            ❌ 완전 다단불가
          </div>
        )}
        {box.noTopLoad && (
          <div style={{ color: theme.warning, marginTop: 4, fontWeight: 600 }}>
            ⚠️ 상단 적재 (최상단 배치)
          </div>
        )}
        {box.stackGroup && (
          <div style={{ color: '#6366f1', marginTop: 4, fontWeight: 600 }}>
            🔗 자체다단: {box.stackGroup}
          </div>
        )}
      </div>
    </div>
  );

  // ── 결과 페이지 ─────────────────────────────────────
  if (page === 'result') {
    const totalContainers = containerLoads.length;
    const DL = 660,
      DW = 180,
      DH = 120;
    const summary = CONTAINER_TYPES.map((ct) => ({
      ...ct,
      count: containerLoads.filter((l) => l.containerType.name === ct.name)
        .length,
    })).filter((s) => s.count > 0);
    const cargoColors = cargos.map((c, i) => ({
      ...c,
      color: COLORS[i % COLORS.length],
    }));

    return (
      <div
        style={{
          minHeight: '100vh',
          background: theme.bg,
          fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        }}
      >
        <Nav
          user={user}
          onLogin={() => setShowAuth(true)}
          onLogout={handleLogout}
          onRecords={loadRecords}
          onBack={() => setPage('input')}
        />
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
          <div style={{ marginBottom: 32 }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: theme.text,
                marginBottom: 6,
              }}
            >
              적재 계산 결과
            </h1>
            <p style={{ fontSize: 14, color: theme.textMuted }}>
              3D Extreme Points · 바닥면 고정 회전 · 자동 컨테이너 선택
            </p>
          </div>

          {user && (
            <div
              style={{
                background: 'white',
                borderRadius: 16,
                padding: 20,
                marginBottom: 24,
                boxShadow: theme.shadow,
                border: `1px solid ${theme.border}`,
                display: 'flex',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: 20 }}>💾</div>
              <input
                id="saveTitle"
                name="saveTitle"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="CLP 이름을 입력하세요 (선택사항)"
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${theme.border}`,
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
                onFocus={(e) => (e.target.style.borderColor = theme.primary)}
                onBlur={(e) => (e.target.style.borderColor = theme.border)}
              />
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '10px 24px',
                  borderRadius: 10,
                  border: 'none',
                  background: saveSuccess
                    ? theme.success
                    : 'linear-gradient(135deg,#44403c,#57534e)',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                }}
              >
                {saving ? '저장 중...' : saveSuccess ? '✅ 저장됨' : '저장하기'}
              </button>
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${2 + summary.length},1fr)`,
              gap: 16,
              marginBottom: 28,
            }}
          >
            {[
              {
                label: '총 컨테이너',
                value: `${totalContainers}개`,
                color: theme.text,
                sub: '자동 선택',
              },
              {
                label: '총 CBM',
                value: `${totalCbm.toFixed(2)} m³`,
                color: theme.primary,
                sub: '총 화물 부피',
              },
              ...summary.map((s) => ({
                label: s.name,
                value: `${s.count}개`,
                color: theme.success,
                sub: `최대 ${s.maxCbm} CBM`,
              })),
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: 'white',
                  borderRadius: 16,
                  padding: 24,
                  boxShadow: theme.shadow,
                  border: `1px solid ${theme.border}`,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: theme.textMuted,
                    fontWeight: 600,
                    marginBottom: 8,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {stat.label}
                </div>
                <div
                  style={{ fontSize: 28, fontWeight: 800, color: stat.color }}
                >
                  {stat.value}
                </div>
                <div
                  style={{ fontSize: 12, color: theme.textMuted, marginTop: 4 }}
                >
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
            const isGood = Number(cbmRate) > 80;
            return (
              <div
                key={load.containerId}
                style={{
                  background: 'white',
                  borderRadius: 20,
                  padding: 28,
                  marginBottom: 20,
                  boxShadow: theme.shadow,
                  border: `1px solid ${theme.border}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        background: isGood ? '#f0fdf4' : '#f5f5f4',
                        borderRadius: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                      }}
                    >
                      🚢
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: 800,
                          fontSize: 16,
                          color: theme.text,
                        }}
                      >
                        컨테이너 {ci + 1} / {totalContainers}
                      </div>
                      <div style={{ fontSize: 12, color: theme.textMuted }}>
                        자동 선택됨
                      </div>
                    </div>
                    <span
                      style={{
                        background: theme.primaryLight,
                        color: theme.primary,
                        fontSize: 12,
                        fontWeight: 700,
                        padding: '5px 12px',
                        borderRadius: 20,
                        border: `1px solid ${theme.border}`,
                      }}
                    >
                      {ct.name}
                    </span>
                    {(load.xImbalance || load.yImbalance) && (
                      <span
                        style={{
                          background: '#fef2f2',
                          color: theme.danger,
                          fontSize: 12,
                          fontWeight: 700,
                          padding: '5px 12px',
                          borderRadius: 20,
                        }}
                      >
                        ⚠️ 무게 편중
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 20, fontSize: 13 }}>
                    {[
                      {
                        label: 'CBM',
                        value: `${loadedCbm.toFixed(2)} / ${ct.maxCbm}`,
                      },
                      {
                        label: '중량',
                        value: `${loadedWeight.toLocaleString()} / ${ct.maxWeight.toLocaleString()}kg`,
                      },
                      {
                        label: '적재율',
                        value: `${cbmRate}%`,
                        big: true,
                        color: isGood ? theme.success : theme.warning,
                      },
                    ].map((item) => (
                      <div key={item.label} style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            fontSize: 11,
                            color: theme.textMuted,
                            marginBottom: 2,
                          }}
                        >
                          {item.label}
                        </div>
                        <div
                          style={{
                            fontWeight: item.big ? 800 : 700,
                            fontSize: item.big ? 18 : 13,
                            color: item.color || theme.text,
                          }}
                        >
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    background: theme.bg,
                    borderRadius: 8,
                    height: 8,
                    marginBottom: 24,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Number(cbmRate))}%`,
                      height: '100%',
                      background: isGood
                        ? `linear-gradient(90deg,${theme.success},#6da882)`
                        : `linear-gradient(90deg,${theme.primary},#78716c)`,
                      borderRadius: 8,
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                  {[
                    {
                      label: '상면도 (위에서)',
                      bg: '#f8faff',
                      border: `2px solid ${theme.primary}20`,
                      isTop: true,
                    },
                    {
                      label: '측면도 (옆에서)',
                      bg: '#f5faf7',
                      border: `2px solid ${theme.success}20`,
                      isTop: false,
                    },
                  ].map(({ label, bg, border, isTop }) => (
                    <div key={label} style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: theme.textMuted,
                          marginBottom: 8,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        {label}
                      </div>
                      <div
                        style={{
                          position: 'relative',
                          height: (isTop ? DW : DH) + 4,
                          background: bg,
                          border,
                          borderRadius: 12,
                          overflow: 'hidden',
                        }}
                      >
                        {isTop && (
                          <>
                            <div
                              style={{
                                position: 'absolute',
                                top: 6,
                                left: 10,
                                fontSize: 9,
                                fontWeight: 700,
                                color: theme.primary,
                                opacity: 0.7,
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
                                background: theme.danger,
                                opacity: 0.2,
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
                                background: theme.danger,
                                opacity: 0.2,
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
                                    ? theme.danger
                                    : theme.success,
                                border: '2px solid white',
                                boxShadow: '0 0 6px rgba(0,0,0,0.2)',
                              }}
                            />
                          </>
                        )}
                        {[...load.boxes]
                          .sort((a, b) => (isTop ? a.z - b.z : a.y - b.y))
                          .map((box, bi) => {
                            const isHovered = hoveredBox === box;
                            const px = box.x * scaleL;
                            const py = isTop
                              ? box.y * scaleW
                              : (ct.height - box.z - box.h) * scaleH;
                            const pw = box.l * scaleL;
                            const ph = isTop ? box.w * scaleW : box.h * scaleH;
                            const opacity = isTop
                              ? 0.65 + (box.z / ct.height) * 0.35
                              : 0.5 + (box.y / ct.width) * 0.5;
                            const zIdx = isTop
                              ? isHovered
                                ? 20
                                : box.z + 1
                              : isHovered
                              ? 20
                              : 10 - Math.floor((box.y / ct.width) * 10);
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
                                  height: Math.max(ph, 1),
                                  background: box.color,
                                  opacity,
                                  borderRadius: 3,
                                  cursor: 'pointer',
                                  overflow: 'hidden',
                                  border: isHovered
                                    ? '2px solid white'
                                    : '1px solid rgba(255,255,255,0.5)',
                                  boxShadow: isHovered
                                    ? `0 0 0 2px ${box.color},0 4px 12px rgba(0,0,0,0.15)`
                                    : 'none',
                                  zIndex: zIdx,
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                {pw > 24 && ph > 16 && (
                                  <div
                                    style={{
                                      color: 'white',
                                      fontSize: 7,
                                      fontWeight: 700,
                                      padding: '2px 3px',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      textShadow: '0 1px 2px rgba(0,0,0,0.3)',
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
                                      background: 'rgba(159,75,75,0.9)',
                                      color: 'white',
                                      fontSize: 5,
                                      padding: '1px 2px',
                                      borderRadius: 2,
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
                                      background: 'rgba(146,114,74,0.9)',
                                      color: 'white',
                                      fontSize: 5,
                                      padding: '1px 2px',
                                      borderRadius: 2,
                                      fontWeight: 800,
                                    }}
                                  >
                                    NT
                                  </div>
                                )}
                                {box.stackGroup && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      bottom: 1,
                                      right: 1,
                                      background: 'rgba(99,102,241,0.9)',
                                      color: 'white',
                                      fontSize: 5,
                                      padding: '1px 2px',
                                      borderRadius: 2,
                                      fontWeight: 800,
                                    }}
                                  >
                                    {box.stackGroup}
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
                          color: theme.textMuted,
                          marginTop: 4,
                        }}
                      >
                        <span>0cm</span>
                        <span>{ct.length}cm</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: theme.textMuted }}>
                  💡 박스 위에 마우스를 올리면 상세 정보 · NO: 완전다단불가 ·
                  NT: 상단적재(최상단) · 보라색: 자체다단 그룹
                </div>
              </div>
            );
          })}

          <div
            style={{
              background: 'white',
              borderRadius: 16,
              padding: 20,
              marginBottom: 20,
              boxShadow: theme.shadow,
              border: `1px solid ${theme.border}`,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: theme.textSecondary,
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              범례
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {cargoColors.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: theme.bg,
                    padding: '6px 12px',
                    borderRadius: 20,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 4,
                      background: c.color,
                    }}
                  />
                  <span
                    style={{ fontSize: 12, color: theme.text, fontWeight: 500 }}
                  >
                    {c.name || '(미입력)'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              background: 'white',
              borderRadius: 16,
              padding: 24,
              marginBottom: 24,
              boxShadow: theme.shadow,
              border: `1px solid ${theme.border}`,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: theme.text,
                marginBottom: 16,
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
                  <tr>
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
                          padding: '10px 12px',
                          textAlign: 'left',
                          color: theme.textMuted,
                          fontWeight: 600,
                          fontSize: 11,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          borderBottom: `2px solid ${theme.border}`,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cargos.map((c, i) => (
                    <tr
                      key={c.id}
                      style={{ borderBottom: `1px solid ${theme.border}` }}
                    >
                      <td
                        style={{
                          padding: '12px',
                          fontWeight: 600,
                          color: theme.text,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 3,
                              background: COLORS[i % COLORS.length],
                              flexShrink: 0,
                            }}
                          />
                          {c.name || '(미입력)'}
                        </div>
                      </td>
                      <td
                        style={{ padding: '12px', color: theme.textSecondary }}
                      >
                        {c.quantity}박스
                      </td>
                      <td
                        style={{ padding: '12px', color: theme.textSecondary }}
                      >
                        {(
                          (c.length / 100) *
                          (c.width / 100) *
                          (c.height / 100)
                        ).toFixed(3)}
                      </td>
                      <td
                        style={{
                          padding: '12px',
                          color: theme.primary,
                          fontWeight: 700,
                        }}
                      >
                        {calcCbm(c).toFixed(3)}
                      </td>
                      <td
                        style={{ padding: '12px', color: theme.textSecondary }}
                      >
                        {c.weight}kg
                      </td>
                      <td style={{ padding: '12px' }}>
                        {c.noStack ? (
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: 20,
                              fontSize: 11,
                              fontWeight: 600,
                              background: '#fef2f2',
                              color: theme.danger,
                            }}
                          >
                            ❌ 완전 다단불가
                          </span>
                        ) : c.noTopLoad ? (
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: 20,
                              fontSize: 11,
                              fontWeight: 600,
                              background: '#fffbeb',
                              color: theme.warning,
                            }}
                          >
                            ⚠️ 상단 적재
                          </span>
                        ) : c.stackGroup ? (
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: 20,
                              fontSize: 11,
                              fontWeight: 600,
                              background: '#eef2ff',
                              color: '#6366f1',
                            }}
                          >
                            🔗 자체다단 {c.stackGroup}
                          </span>
                        ) : (
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: 20,
                              fontSize: 11,
                              fontWeight: 600,
                              background: '#f0fdf4',
                              color: theme.success,
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

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => setPage('input')}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 12,
                border: `1.5px solid ${theme.border}`,
                background: 'white',
                color: theme.textSecondary,
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ← 다시 입력
            </button>
            <button
              onClick={handleReset}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 12,
                border: `1.5px solid ${theme.danger}`,
                background: '#fef2f2',
                color: theme.danger,
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              🗑️ 초기화하고 새로 시작
            </button>
          </div>
        </div>
        <Footer />
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
            duplicateRecord={duplicateRecord}
            editingRecord={editingRecord}
            setEditingRecord={setEditingRecord}
            saveTitle={saveTitle}
            setSaveTitle={setSaveTitle}
            updateRecord={updateRecord}
            saving={saving}
            saveSuccess={saveSuccess}
          />
        )}
      </div>
    );
  }

  // ── 입력 페이지 ─────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.bg,
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      }}
    >
      <Nav
        user={user}
        onLogin={() => setShowAuth(true)}
        onLogout={handleLogout}
        onRecords={loadRecords}
      />
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: theme.primaryLight,
              color: theme.textSecondary,
              padding: '6px 16px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 16,
              border: `1px solid ${theme.border}`,
            }}
          >
            ✦ 포워더를 위한 무료 CLP 툴
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 900,
              color: theme.text,
              marginBottom: 12,
              lineHeight: 1.2,
            }}
          >
            화물을 입력하면
            <br />
            <span
              style={{ color: '#44403c', borderBottom: '3px solid #a8a29e' }}
            >
              최적의 적재 방법
            </span>
            을 찾아드려요
          </h1>
          <p
            style={{
              fontSize: 15,
              color: theme.textSecondary,
              maxWidth: 480,
              margin: '0 auto',
            }}
          >
            20GP · 40HQ 컨테이너를 자동으로 선택하고, 3D 배치 알고리즘으로 최대
            효율을 계산해요
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            marginBottom: 28,
          }}
        >
          {CONTAINER_TYPES.map((ct) => (
            <div
              key={ct.name}
              style={{
                background: 'white',
                borderRadius: 16,
                padding: 20,
                boxShadow: theme.shadow,
                border: `1px solid ${theme.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  background:
                    ct.name === '40HQ'
                      ? 'linear-gradient(135deg,#44403c,#57534e)'
                      : 'linear-gradient(135deg,#4d7c60,#6da882)',
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  flexShrink: 0,
                }}
              >
                📦
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 16,
                    color: theme.text,
                    marginBottom: 2,
                  }}
                >
                  {ct.name}
                </div>
                <div style={{ fontSize: 12, color: theme.textMuted }}>
                  최대 {ct.maxCbm} CBM · {ct.maxWeight.toLocaleString()} kg
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            background: 'white',
            borderRadius: 20,
            padding: 28,
            marginBottom: 20,
            boxShadow: theme.shadow,
            border: `1px solid ${theme.border}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: theme.text,
                  marginBottom: 4,
                }}
              >
                화물 목록
              </h2>
              <p style={{ fontSize: 13, color: theme.textMuted }}>
                총 {cargos.length}개 품목 · {totalCbm.toFixed(3)} CBM ·{' '}
                {totalWeight.toLocaleString()} kg
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="file"
                accept=".xlsx,.xls"
                id="excelUpload"
                style={{ display: 'none' }}
                onChange={handleExcelUpload}
              />
              <button
                onClick={() => document.getElementById('excelUpload')?.click()}
                style={{
                  padding: '9px 16px',
                  background: 'white',
                  color: theme.success,
                  border: `1.5px solid ${theme.success}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                📊 엑셀 업로드
              </button>
              <input
                id="quickInput"
                name="quickInput"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd()}
                placeholder="291x111x142(2)"
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${theme.border}`,
                  fontSize: 13,
                  outline: 'none',
                  width: 200,
                  fontFamily: 'inherit',
                }}
                onFocus={(e) => (e.target.style.borderColor = theme.primary)}
                onBlur={(e) => (e.target.style.borderColor = theme.border)}
              />
              <button
                onClick={handleQuickAdd}
                disabled={quickAddLoading}
                style={{
                  padding: '9px 16px',
                  background: quickAddLoading ? theme.bg : theme.primaryLight,
                  color: theme.primary,
                  border: `1.5px solid ${theme.primary}`,
                  borderRadius: 10,
                  cursor: quickAddLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {quickAddLoading ? '⏳ 인식 중...' : '✨ 빠른 추가'}
              </button>
            </div>
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
                <tr style={{ background: theme.bg }}>
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
                    '자체다단',
                    '',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 8px',
                        textAlign: 'left',
                        color: theme.textMuted,
                        fontWeight: 600,
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px',
                        borderBottom: `2px solid ${theme.border}`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cargos.map((c, idx) => (
                  <tr
                    key={c.id}
                    style={{
                      borderBottom: `1px solid ${theme.border}`,
                      background: c.parseError
                        ? 'rgba(159,75,75,0.12)'
                        : c.highlighted
                        ? 'rgba(77,124,96,0.07)'
                        : 'transparent',
                      boxShadow: c.parseError
                        ? `inset 3px 0 0 ${theme.danger}`
                        : c.highlighted
                        ? `inset 3px 0 0 ${theme.success}`
                        : 'none',
                      transition: 'background 0.5s ease, box-shadow 0.5s ease',
                    }}
                  >
                    <td style={{ padding: '8px 8px' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            background: COLORS[idx % COLORS.length],
                            flexShrink: 0,
                          }}
                        />
                        <input
                          id={`name-${c.id}`}
                          name={`name-${c.id}`}
                          value={c.name}
                          onChange={(e) =>
                            updateCargo(c.id, 'name', e.target.value)
                          }
                          placeholder="품명"
                          style={{ ...inputStyle, width: 70 }}
                        />
                      </div>
                    </td>
                    {(
                      [
                        'length',
                        'width',
                        'height',
                        'weight',
                        'quantity',
                      ] as const
                    ).map((field) => (
                      <td key={field} style={{ padding: '10px 12px' }}>
                        <input
                          id={`${field}-${c.id}`}
                          name={`${field}-${c.id}`}
                          type="number"
                          value={c[field] || ''}
                          onChange={(e) =>
                            updateCargo(c.id, field, Number(e.target.value))
                          }
                          style={{ ...inputStyle, width: 58 }}
                        />
                      </td>
                    ))}
                    <td
                      style={{
                        padding: '10px 12px',
                        color: theme.primary,
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {calcCbm(c).toFixed(3)}
                    </td>
                    {/* 다단불가 */}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={c.noStack || false}
                        onChange={(e) =>
                          setCargos((prev) =>
                            prev.map((item) =>
                              item.id === c.id
                                ? {
                                    ...item,
                                    noStack: e.target.checked,
                                    noTopLoad: e.target.checked
                                      ? false
                                      : item.noTopLoad,
                                    stackGroup: e.target.checked
                                      ? ''
                                      : item.stackGroup,
                                  }
                                : item
                            )
                          )
                        }
                        style={{
                          width: 16,
                          height: 16,
                          cursor: 'pointer',
                          accentColor: theme.danger,
                        }}
                      />
                    </td>
                    {/* 상단적재 */}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={c.noTopLoad || false}
                        onChange={(e) =>
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
                          )
                        }
                        style={{
                          width: 16,
                          height: 16,
                          cursor: 'pointer',
                          accentColor: theme.warning,
                        }}
                      />
                    </td>
                    {/* 자체다단 */}
                    <td style={{ padding: '10px 12px' }}>
                      <input
                        id={`stackGroup-${c.id}`}
                        name={`stackGroup-${c.id}`}
                        value={c.stackGroup || ''}
                        onChange={(e) =>
                          updateCargo(c.id, 'stackGroup', e.target.value)
                        }
                        placeholder="A"
                        title="같은 값끼리만 쌓기 가능"
                        style={{
                          ...inputStyle,
                          width: 36,
                          textAlign: 'center',
                        }}
                      />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button
                        onClick={() => removeCargo(c.id)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: `1px solid ${theme.border}`,
                          background: 'white',
                          color: theme.textMuted,
                          cursor: 'pointer',
                          fontSize: 14,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontFamily: 'inherit',
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

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 16,
              paddingTop: 16,
              borderTop: `1px solid ${theme.border}`,
            }}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={addCargo}
                style={{
                  padding: '8px 16px',
                  borderRadius: 10,
                  border: `1.5px dashed ${theme.border}`,
                  background: 'white',
                  color: theme.textSecondary,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                + 품목 추가
              </button>
              <button
                onClick={() => setCargos([])}
                style={{
                  padding: '8px 16px',
                  borderRadius: 10,
                  border: `1.5px solid ${theme.danger}`,
                  background: '#fef2f2',
                  color: theme.danger,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                🗑️ 전체 삭제
              </button>
            </div>
            <div style={{ fontSize: 12, color: theme.textMuted }}>
              💡 다단불가: 바닥에만 배치 &nbsp;|&nbsp; 상단적재: 최상단 배치
              &nbsp;|&nbsp; 자체다단: 같은 값끼리만 쌓기
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={calculate}
            disabled={calculating}
            style={{
              flex: 1,
              padding: 18,
              borderRadius: 16,
              border: 'none',
              background: calculating
                ? '#a8a29e'
                : 'linear-gradient(135deg,#44403c,#57534e)',
              color: 'white',
              fontWeight: 800,
              fontSize: 16,
              cursor: calculating ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              boxShadow: calculating ? 'none' : '0 8px 24px rgba(68,64,60,0.2)',
              transition: 'all 0.2s',
              letterSpacing: '0.3px',
            }}
          >
            {calculating ? '⏳ 최적 배치 계산 중...' : '🔍 최적 적재 계산하기'}
          </button>
          <button
            onClick={calculateDraft}
            disabled={calculating}
            style={{
              padding: '18px 24px',
              borderRadius: 16,
              border: `2px solid ${theme.success}`,
              background: 'white',
              color: theme.success,
              fontWeight: 800,
              fontSize: 15,
              cursor: calculating ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            📦 20GP DRAFT
          </button>
        </div>
      </div>
      <Footer />
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
          duplicateRecord={duplicateRecord}
          editingRecord={editingRecord}
          setEditingRecord={setEditingRecord}
          saveTitle={saveTitle}
          setSaveTitle={setSaveTitle}
          updateRecord={updateRecord}
          saving={saving}
          saveSuccess={saveSuccess}
        />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: `1.5px solid #e7e5e4`,
  fontSize: 13,
  width: 90,
  outline: 'none',
  fontFamily: 'inherit',
  transition: 'border-color 0.2s',
};

const navBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 10,
  border: `1.5px solid ${theme.primary}`,
  background: theme.primaryLight,
  color: theme.primary,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
