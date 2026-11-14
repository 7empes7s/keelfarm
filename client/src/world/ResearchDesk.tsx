// The Researcher's desk (#664) in the CEO's office, next to the IT office: a desk with a laptop and a pile of books,
// the Researcher behind it (never in the office's agent list, so made here), and a tag with what they research and
// for how long. E (or a tap) opens the chat, where the strip shows the job and its Stop. layout.ts has where it stands.

import { useEffect, useMemo, useState } from 'react';
import { Billboard } from '@react-three/drei';
import type * as THREE from 'three';
import { useStore, type Agent } from '../store';
import { RESEARCHER_ID, RESEARCHER_NAME, researchLine } from '../../../shared/research';
import { Character } from './Character';
import { drawSign } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { RESEARCH_DESK, RESEARCHER_SEAT } from './layout';
import { Box } from './Toon';
import { BILLBOARD } from './viewTags';

const ACCENT = '#6a4c93';
const BOOKS = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653'];

function researcherAgent(name: string, busy: boolean, topic: string | null): Agent {
  return {
    id: RESEARCHER_ID, name, repoId: '', role: 'agent', look: 'feminine', task: null, desk: 0, color: ACCENT, hair: '#1d1d1d', skin: '#8d5524', style: null,
    model: '', effort: '', cli: '', terminal: false, status: busy ? 'working' : 'idle', issueNumber: null, issueTitle: topic, branch: null, prNumber: null, prUrl: null,
    currentTool: null, startedAt: null, endedAt: null, costUsd: 0, turns: 0, browserUrl: null, hasScreenshot: false, screenshotAt: null, lastError: null, career: null,
  };
}

function Tag({ name, line }: { name: string; line: string }) {
  const tex = useCanvasTexture(
    512,
    150,
    (ctx) => drawSign(ctx, 512, 150, [{ text: `${name} · Research`, size: 46 }, { text: line, size: 32, weight: 600, color: line === 'free' ? '#e0d7f5' : '#ffe066' }], ACCENT),
    [name, line],
  );
  return (
    <Billboard position={[0, 2.05, 0]} userData={BILLBOARD}>
      <mesh>
        <planeGeometry args={[1.1, 0.32]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

export function ResearchDesk() {
  const v = useStore((s) => s.research);
  const [now, setNow] = useState(() => Date.now());
  const busy = !!v?.job;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [busy]);
  const name = v?.name ?? RESEARCHER_NAME;
  const topic = v?.job?.topic ?? null;
  const person = useMemo(() => researcherAgent(name, busy, topic), [name, busy, topic]);
  const line = researchLine(v, now);
  const label = topic ? `${name} is researching “${topic.length > 50 ? `${topic.slice(0, 49)}…` : topic}”: open the chat` : `${name}, the researcher: ask "Research: …" in the chat`;
  const ref = useInteractable<THREE.Group>({ id: 'researcher', label, action: { kind: 'phone', tab: 'chat' } }, 3.2);
  useEffect(() => void ((window as unknown as { __swarmResearchDesk?: unknown }).__swarmResearchDesk = { name, topic, line }), [name, topic, line]); // what the desk shows, for QA
  const d = RESEARCH_DESK;
  return (
    <group ref={ref}>
      <group position={[d.x, 0, d.z]}>
        <Box size={[d.w, 0.06, d.d]} position={[0, d.h, 0]} color="#d4a373" outline />
        <Box size={[d.w - 0.1, d.h - 0.03, 0.05]} position={[0, (d.h - 0.03) / 2, -d.d / 2 + 0.05]} color="#a7754d" />
        <Box size={[0.06, d.h - 0.03, d.d - 0.1]} position={[-d.w / 2 + 0.06, (d.h - 0.03) / 2, 0]} color="#a7754d" />
        <Box size={[0.06, d.h - 0.03, d.d - 0.1]} position={[d.w / 2 - 0.06, (d.h - 0.03) / 2, 0]} color="#a7754d" />
        {/* the laptop, open towards the chair, and a pile of books */}
        <Box size={[0.5, 0.02, 0.34]} position={[0.05, d.h + 0.04, 0.08]} color="#adb5bd" outline />
        <Box size={[0.5, 0.32, 0.02]} position={[0.05, d.h + 0.2, -0.09]} rotation={[-0.2, 0, 0]} color="#343a40" outline />
        {BOOKS.map((c, i) => (
          <Box key={c} size={[0.32, 0.06, 0.24]} position={[-0.5, d.h + 0.06 + i * 0.065, -0.05]} rotation={[0, i * 0.18, 0]} color={c} outline />
        ))}
      </group>
      <Box size={[0.56, 0.1, 0.56]} position={[RESEARCHER_SEAT.x, 0.46, RESEARCHER_SEAT.z]} color="#2b2d42" outline />
      <group position={[RESEARCHER_SEAT.x, 0, RESEARCHER_SEAT.z]}>
        <Character agent={person} />
        <Tag name={name} line={line} />
      </group>
    </group>
  );
}
