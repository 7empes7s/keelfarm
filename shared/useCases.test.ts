import { describe, expect, it } from 'vitest';
import { detectUseCase, missingChecks, qaBriefChecks, USE_CASES, caseDef } from './useCases';

const pkg = (deps: Record<string, string>, extra: object = {}) => JSON.stringify({ name: 'x', dependencies: deps, ...extra });

describe('detectUseCase on fixture repos', () => {
  it('a three.js game is a game, before it is a Vite app', () => {
    expect(detectUseCase({ 'package.json': pkg({ three: '^0.170.0', vite: '^6.0.0' }) })).toEqual({ useCase: 'game-3d', why: 'three in package.json' });
    expect(detectUseCase({ 'package.json': JSON.stringify({ devDependencies: { '@react-three/fiber': '9', react: '19' } }) })?.useCase).toBe('game-3d');
  });

  it('a Next.js app is a web app', () => {
    expect(detectUseCase({ 'package.json': pkg({ next: '15', react: '19', 'react-dom': '19' }) })).toEqual({ useCase: 'web-app', why: 'next in package.json' });
  });

  it('an Express server is an API', () => {
    expect(detectUseCase({ 'package.json': pkg({ express: '^5.0.0', zod: '3' }), Dockerfile: 'FROM node:24' })).toEqual({ useCase: 'api', why: 'express in package.json' });
  });

  it('a Python package is a library; with FastAPI it is an API', () => {
    const lib = '[project]\nname = "tidy"\ndependencies = ["click>=8", "rich"]\n';
    expect(detectUseCase({ 'pyproject.toml': lib })).toEqual({ useCase: 'cli-library', why: 'a pyproject.toml without a web framework' });
    expect(detectUseCase({ 'pyproject.toml': '[project]\ndependencies = ["fastapi", "uvicorn"]' })).toEqual({ useCase: 'api', why: 'fastapi in pyproject.toml' });
    expect(detectUseCase({ 'requirements.txt': 'torch==2.4\nnumpy' })).toEqual({ useCase: 'research', why: 'torch in requirements.txt' });
  });

  it('reads the other kinds and says when it has no idea', () => {
    expect(detectUseCase({ 'package.json': pkg({ expo: '52', 'react-native': '0.76' }) })?.useCase).toBe('mobile');
    expect(detectUseCase({ 'package.json': pkg({ astro: '5' }) })?.useCase).toBe('static-site');
    expect(detectUseCase({ 'package.json': pkg({ chalk: '5' }, { bin: { tidy: 'cli.js' } }) })?.useCase).toBe('cli-library');
    expect(detectUseCase({ 'Cargo.toml': '[dependencies]\naxum = "0.7"' })?.useCase).toBe('api');
    expect(detectUseCase({ 'index.html': '<h1>hi</h1>' })?.useCase).toBe('static-site');
    expect(detectUseCase({ 'main.tf': 'provider "hcloud" {}' })?.useCase).toBe('ops');
    expect(detectUseCase({ 'package.json': 'not json' })?.useCase).toBe('cli-library');
    expect(detectUseCase({})).toBeNull();
  });

  it('a word inside another name is not a match (flask-free, not flask)', () => {
    expect(detectUseCase({ 'requirements.txt': 'flaskless-utils' })).toBeNull();
  });
});

describe('the recommendations table', () => {
  it('has a why, a guide-worthy label and QA checks for every use case, and Gemini never builds', () => {
    for (const u of USE_CASES) {
      expect(u.why.length).toBeGreaterThan(10);
      expect(u.qaChecks.length).toBeGreaterThan(0);
      expect(u.jobs.build.model).not.toMatch(/gemini/i);
    }
  });

  it("a game's QA brief must check the frame rate", () => {
    const game = caseDef('game-3d');
    expect(missingChecks(game, 'Open the canvas, no console errors, test keyboard controls').map((c) => c.label)).toEqual(['Frame rate stays smooth (about 60 fps, no long stalls)']);
    expect(missingChecks(game, qaBriefChecks(game))).toEqual([]);
  });
});
