import { expect, it, mock } from 'bun:test';

// Keep the SecureImage mock out of the shared Bun module cache.
if (process.env.EVIDENCE_VIEWER_CHILD !== '1') {
  it('checks the evidence viewer in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { EVIDENCE_VIEWER_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  const { renderToStaticMarkup } = await import('react-dom/server');

  mock.module('@/shared/ui/secure-image', () => ({
    SecureImage: ({ path, alt }: { path: string; alt: string }) => (
      <img data-path={path} alt={alt} />
    ),
  }));

  const { EvidenceViewer } = await import('./evidence-viewer');

  const render = (
    evidence: Array<{ kind: 'physical' | 'performance'; storage_path: string }>,
    benchmarkScore: number | null,
  ) =>
    renderToStaticMarkup(
      <EvidenceViewer
        evidence={evidence}
        benchmarkScore={benchmarkScore}
        images={['p1/sale.png']}
        onImageClick={() => undefined}
      />,
    );

  it('shows every proof of the attempt under its kind, with the benchmark score', () => {
    const html = render(
      [
        { kind: 'physical', storage_path: 'p1/paper-a.png' },
        { kind: 'physical', storage_path: 'p1/paper-b.png' },
        { kind: 'performance', storage_path: 'p1/bench.png' },
      ],
      15234,
    );

    expect(html).toContain('data-path="p1/paper-a.png" alt="Prueba física 1"');
    expect(html).toContain('data-path="p1/paper-b.png" alt="Prueba física 2"');
    expect(html).toContain('data-path="p1/bench.png" alt="Benchmark 1"');
    expect(html).toContain('Score: 15234');
    expect(html).not.toContain('Sin prueba física');
    expect(html).not.toContain('Sin benchmark adjunto');
    expect(html).toContain('data-path="p1/sale.png"');
  });

  it('says when the attempt has no proof of a kind', () => {
    const html = render([], null);

    expect(html).toContain('Sin prueba física');
    expect(html).toContain('Sin benchmark adjunto');
    expect(html).not.toContain('Score:');
  });
}
