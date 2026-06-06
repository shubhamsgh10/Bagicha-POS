// node-zklib ships no type declarations — treat it as `any`.
declare module "node-zklib" {
  const ZKLib: any;
  export default ZKLib;
}
