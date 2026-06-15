use criterion::{Criterion, criterion_group, criterion_main};

fn upload_benchmark(c: &mut Criterion) {
    c.bench_function("upload_benchmark_placeholder", |b| b.iter(|| ()));
}

criterion_group!(benches, upload_benchmark);
criterion_main!(benches);
