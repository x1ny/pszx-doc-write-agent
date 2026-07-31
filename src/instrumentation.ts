export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { ensureSystemMaterials } = await import(
    './mastra/document/materials'
  );
  await ensureSystemMaterials();
}
