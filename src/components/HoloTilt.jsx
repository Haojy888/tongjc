import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import './HoloTilt.css';

const clamp = (value, min = 0, max = 100) => Math.min(Math.max(value, min), max);
const round = (value, precision = 3) => parseFloat(value.toFixed(precision));
const adjust = (value, fromMin, fromMax, toMin, toMax) =>
  round(toMin + ((toMax - toMin) * (value - fromMin)) / (fromMax - fromMin));

function HoloTilt({
  children,
  className = '',
  intensity = 0.65,
  glowColor = 'rgba(240, 179, 92, 0.46)',
  innerGradient = 'linear-gradient(145deg, rgba(217,86,69,0.12), rgba(104,129,242,0.08))'
}) {
  const wrapRef = useRef(null);
  const rafRef = useRef(null);
  const stateRef = useRef({
    currentX: 50,
    currentY: 50,
    targetX: 50,
    targetY: 50,
    running: false
  });

  const setVars = useCallback((percentX, percentY) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const centerX = percentX - 50;
    const centerY = percentY - 50;
    wrap.style.setProperty('--holo-x', `${percentX}%`);
    wrap.style.setProperty('--holo-y', `${percentY}%`);
    wrap.style.setProperty('--holo-bg-x', `${adjust(percentX, 0, 100, 36, 64)}%`);
    wrap.style.setProperty('--holo-bg-y', `${adjust(percentY, 0, 100, 34, 66)}%`);
    wrap.style.setProperty('--holo-from-center', `${clamp(Math.hypot(centerX, centerY) / 50, 0, 1)}`);
    wrap.style.setProperty('--holo-rotate-x', `${round(-centerY * 0.045 * intensity)}deg`);
    wrap.style.setProperty('--holo-rotate-y', `${round(centerX * 0.055 * intensity)}deg`);
  }, [intensity]);

  const animate = useCallback(() => {
    const state = stateRef.current;
    if (!state.running) return;

    state.currentX += (state.targetX - state.currentX) * 0.14;
    state.currentY += (state.targetY - state.currentY) * 0.14;
    setVars(state.currentX, state.currentY);

    const settled = Math.abs(state.targetX - state.currentX) < 0.08 && Math.abs(state.targetY - state.currentY) < 0.08;
    if (settled) {
      state.running = false;
      rafRef.current = null;
      return;
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [setVars]);

  const start = useCallback(() => {
    const state = stateRef.current;
    if (state.running) return;
    state.running = true;
    rafRef.current = requestAnimationFrame(animate);
  }, [animate]);

  const moveTo = useCallback((event) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const percentX = clamp(((event.clientX - rect.left) / rect.width) * 100);
    const percentY = clamp(((event.clientY - rect.top) / rect.height) * 100);
    stateRef.current.targetX = percentX;
    stateRef.current.targetY = percentY;
    start();
  }, [start]);

  const reset = useCallback(() => {
    stateRef.current.targetX = 50;
    stateRef.current.targetY = 50;
    start();
  }, [start]);

  useEffect(() => {
    setVars(62, 42);
    const timer = window.setTimeout(reset, 420);
    return () => {
      window.clearTimeout(timer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reset, setVars]);

  const style = useMemo(() => ({
    '--holo-glow-color': glowColor,
    '--holo-inner-gradient': innerGradient
  }), [glowColor, innerGradient]);

  return (
    <div
      ref={wrapRef}
      className={`holo-tilt ${className}`.trim()}
      style={style}
      onPointerEnter={moveTo}
      onPointerMove={moveTo}
      onPointerLeave={reset}
    >
      <div className="holo-behind" aria-hidden="true" />
      <div className="holo-shell">
        <div className="holo-shine" aria-hidden="true" />
        <div className="holo-glare" aria-hidden="true" />
        <div className="holo-content">{children}</div>
      </div>
    </div>
  );
}

export default React.memo(HoloTilt);
