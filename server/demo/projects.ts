// The demo's projects folder (#257): the demo repos, one git folder that isn't on GitHub yet and one plain folder;
// publishing or creating a project makes a new, empty fake repo.
import type { LocalFolder } from '../workspace.ts';
import { registerDemo } from './registry.ts';
import { bareRepos, repos, restoreNumbers } from './world.ts';

registerDemo('projects', () => {
  // A pretend projects folder: the demo repos, one git folder that isn't on GitHub yet, and one plain folder.
  const folders = new Map<string, LocalFolder>();
  const addFolder = (name: string, github: string | null, git = true) =>
    folders.set(name, { name, path: `/demo/projects/${name}`, git, github, modified: Date.now() - folders.size * 3_600_000 });
  for (const r of repos.values()) addFolder(r.fullName.split('/')[1], r.fullName);
  addFolder('sketchbook', null);
  addFolder('recipe-notes', null, false);
  const newRepo = (name: string, description = '') => {
    const fullName = `demo-co/${name}`;
    if (!repos.has(fullName)) {
      repos.set(fullName, { fullName, description, issues: [], pulls: [], nextNumber: 1 });
      bareRepos.add(fullName);
      restoreNumbers();
    }
    addFolder(name, fullName);
    return fullName;
  };
  const folderOf = (dir: string) => {
    const f = folders.get(dir.replace(/\\/g, '/').split('/').pop() ?? '');
    if (!f) throw new Error(`${dir} is not a folder`);
    return f;
  };
  return {
    setLocalPath: () => undefined,
    scanProjects: async () => [...folders.values()].sort((a, b) => b.modified - a.modified),
    inspectFolder: async (dir) => folderOf(dir),
    publishFolder: async (dir, opts) => {
      const f = folderOf(dir);
      return f.github ?? newRepo(f.name, opts.description);
    },
    createProject: async (_root, name, opts) => {
      if (folders.has(name)) throw new Error(`/demo/projects/${name} already exists. Pick another name, or connect that folder instead.`);
      return { fullName: newRepo(name, opts.description), path: `/demo/projects/${name}` };
    },
  };
});
