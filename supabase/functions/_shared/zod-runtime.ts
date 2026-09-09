import type { z as Zod } from 'https://esm.sh/zod@3.23.8';

const moduleSpecifier =
  typeof Deno === 'undefined' ? 'zod' : 'npm:zod@3.23.8';
const zodModule = await import(moduleSpecifier);

export const z: typeof Zod = zodModule.z;
