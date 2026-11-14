import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../store', () => ({ useStore: (select: (s: object) => unknown) => select({}) }));
vi.mock('./mic', () => ({ handsFreeProblem: () => null, setHandsFree: () => {} }));
vi.mock('./voiceCallEngine', () => ({ startCall: () => {} }));
import { ChatActionsSheet } from './ChatActionsSheet';

describe('the + file pickers (#660)', () => {
  const inputs = () => renderToStaticMarkup(<ChatActionsSheet text="" ceoName="Mimoun" onFiles={() => {}} onResearch={() => {}} onQuick={() => {}} />).match(/<input[^>]*>/g) ?? [];

  it('lets the files picker choose any file, and keeps the camera to photos and videos', () => {
    const [files, camera] = inputs();
    expect(files).toContain('multiple');
    expect(files).not.toMatch(/accept=/);
    expect(camera).toContain('accept="image/*,video/*"');
    expect(camera).toContain('capture="environment"');
  });
});
