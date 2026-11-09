// The one stripe specifier the Edge Functions use. Its version must equal the
// root package.json devDependency (scripts/guards/edge-function-npm-pins.test.ts);
// bump both together, with STRIPE_API_VERSION in ./api-version.ts.
export { default } from 'npm:stripe@23.1.0';
