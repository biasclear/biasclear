// The one reviewed model table. The stack selector, prices and exact IAM
// resources are generated/checked against this table by infra/aws/model-table.mjs.
// Base IDs were copied from the account console; profile IDs and destinations
// were copied from AWS model cards linked from that console. These are US
// cross-region routes, not in-region calls. Brad approved these US profiles
// on 2026-10-07; changing the route or adding a model requires a new review.

export interface ModelInfo {
  readonly displayName: string;
  readonly key: string;
  readonly provider: string;
  readonly foundationModelId: string;
  readonly region: string;
  readonly route: "us-profile";
  readonly destinationRegions: readonly string[];
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  /** Visible/requested output cap. It is not assumed to bound billed reasoning. */
  readonly maxTokens: number;
  /** Documented thinking + text bound; null refuses live startup. */
  readonly billedMaxTokens: number | null;
  readonly liveBlockReason: string;
  readonly settingsVerified: boolean;
  readonly requestFields: Readonly<Record<string, unknown>>;
  readonly source: Readonly<Record<string, string>>;
}

export const DEFAULT_MODEL_ID = "us.xai.grok-4.7";

// BEGIN_REVIEWED_MODEL_TABLE
const MODEL_TABLE = {
  "us.xai.grok-4.7": {
    "displayName": "Grok 4.7",
    "key": "grok47",
    "provider": "xAI",
    "foundationModelId": "xai.grok-4.7",
    "region": "us-east-1",
    "route": "us-profile",
    "destinationRegions": [
      "us-east-1",
      "us-east-2",
      "us-west-2"
    ],
    "inputPricePerMillion": 2.2,
    "outputPricePerMillion": 6.6,
    "maxTokens": 400,
    "billedMaxTokens": null,
    "liveBlockReason": "Bedrock billed reasoning-token bound is unverified; visible maxTokens is not assumed to bound total cost.",
    "settingsVerified": true,
    "requestFields": {
      "reasoning_effort": "low"
    },
    "source": {
      "baseId": "AWS Bedrock Model catalog, us-east-1, copied 2026-10-07",
      "profile": "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html",
      "price": "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html",
      "settings": "https://aws.amazon.com/blogs/machine-learning/grok-4-7-is-now-available-on-amazon-bedrock/"
    }
  },
  "us.anthropic.claude-sonnet-5-5": {
    "displayName": "Claude Sonnet 5.5",
    "key": "sonnet55",
    "provider": "Anthropic",
    "foundationModelId": "anthropic.claude-sonnet-5-5",
    "region": "us-east-1",
    "route": "us-profile",
    "destinationRegions": [
      "us-east-1",
      "us-east-2",
      "us-west-2"
    ],
    "inputPricePerMillion": 2.2,
    "outputPricePerMillion": 11,
    "maxTokens": 400,
    "billedMaxTokens": 400,
    "liveBlockReason": "",
    "settingsVerified": true,
    "requestFields": {
      "thinking": {
        "type": "adaptive"
      },
      "output_config": {
        "effort": "low"
      }
    },
    "source": {
      "baseId": "AWS Bedrock Model catalog, us-east-1, copied 2026-10-07",
      "profile": "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html",
      "price": "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/20260930001912/us-east-1/index.json",
      "settings": "https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html"
    }
  },
  "us.openai.gpt-6.1-sol": {
    "displayName": "GPT-6.1 Sol",
    "key": "sol61",
    "provider": "OpenAI",
    "foundationModelId": "openai.gpt-6.1-sol",
    "region": "us-east-1",
    "route": "us-profile",
    "destinationRegions": [
      "us-east-1",
      "us-east-2",
      "us-west-2"
    ],
    "inputPricePerMillion": 2.2,
    "outputPricePerMillion": 11,
    "maxTokens": 400,
    "billedMaxTokens": null,
    "liveBlockReason": "Bedrock lowest reasoning setting and billed total-token bound are unverified.",
    "settingsVerified": false,
    "requestFields": {},
    "source": {
      "baseId": "AWS Bedrock Model catalog, us-east-1, copied 2026-10-07",
      "profile": "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html",
      "price": "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html",
      "settings": "Lowest reasoning setting and total billed-token bound are unverified; live startup is blocked."
    }
  }
};
// END_REVIEWED_MODEL_TABLE

for (const model of Object.values(MODEL_TABLE)) {
  Object.freeze(model.destinationRegions);
  Object.freeze(model.requestFields);
  Object.freeze(model.source);
  Object.freeze(model);
}
export const MODELS: Readonly<Record<string, ModelInfo>> = Object.freeze(MODEL_TABLE) as Readonly<Record<string, ModelInfo>>;
