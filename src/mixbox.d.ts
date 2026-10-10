declare module "mixbox" {
  const mixbox: {
    LATENT_SIZE: number;
    rgbToLatent(rgb: readonly number[]): number[];
    latentToRgb(latent: readonly number[]): number[];
    lerp(a: readonly number[], b: readonly number[], t: number): number[];
  };
  export default mixbox;
}
