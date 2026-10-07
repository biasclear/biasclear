interface ModelEntry {
  key: string;
  displayName: string;
  provider: string;
  foundationModelId: string;
  region: string;
  route: string;
  destinationRegions: readonly string[];
  source: Readonly<Record<string, string>>;
}
interface Table {
  models: Record<string, ModelEntry>;
  defaultId: string;
  defaultKey: string;
}
export const DRAFT_FILE: string;
export function privacyDraft(id: string, model: ModelEntry): {
  id: string; key: string; maker: string; displayName: string;
  sourceRegion: string; destinationRegions: string[];
  consent: string; privacy: string;
};
export function renderDrafts(table?: Table): string;
