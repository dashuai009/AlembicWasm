declare module '../../AbcWASM/dist/alembic_echo_wasm.js' {
  const initModule: (options?: any) => Promise<any>;
  export default initModule;
}

declare module '*.wasm' {
  const content: any;
  export = content;
}

declare module '*.js' {
  const content: any;
  export default content;
}