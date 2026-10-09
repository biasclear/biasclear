export declare const TEMPLATE: string;
export declare const PRICE_URL: string;
export declare function templateDefault(yaml: string, name: string): string;
export declare function listPrices(sources: unknown, modelId: string): { input: number; output: number };
export declare function compare(yaml: string, sources: unknown): {
  ok: boolean; defaultKey: string;
  rows: Array<{modelId: string; reviewed: {input: number;output: number};list: {input:number;output:number};ok:boolean}>;
};
