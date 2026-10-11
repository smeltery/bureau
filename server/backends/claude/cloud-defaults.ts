type Environment = Record<string, string | undefined>;

const REGIONS: Record<string, readonly string[]> = {
  us: ["us-east-1", "us-east-2", "us-west-1", "us-west-2"],
  eu: ["eu-central-1", "eu-central-2", "eu-north-1", "eu-south-1", "eu-south-2", "eu-west-1", "eu-west-2", "eu-west-3"],
  au: ["ap-southeast-2", "ap-southeast-4"],
  jp: ["ap-northeast-1", "ap-northeast-3"],
};
const FAMILIES = [
  { name: "SONNET", model: "claude-sonnet-5-5", vertexRegion: "VERTEX_REGION_CLAUDE_5_5_SONNET", geographies: ["us", "eu", "au"] },
  { name: "HAIKU", model: "claude-haiku-5-5", vertexRegion: "VERTEX_REGION_CLAUDE_HAIKU_5_5", geographies: ["us", "eu", "au", "jp"] },
];
const enabled = (value: string | undefined) => ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
const geography = (region: string | undefined) => Object.keys(REGIONS).find((geo) => REGIONS[geo]!.includes(region ?? ""));

/** Resolve after office, personal and room variables have been merged. */
export function withCloudModelDefaults(env: Environment = process.env): Environment {
  const bedrock = enabled(env.CLAUDE_CODE_USE_BEDROCK);
  if (!bedrock && !enabled(env.CLAUDE_CODE_USE_VERTEX)) return env;
  if (bedrock && env.ANTHROPIC_BEDROCK_REGION_PREFIX?.trim()) return env;
  const result = { ...env };
  const geo = geography(env.AWS_REGION || env.AWS_DEFAULT_REGION);
  for (const family of FAMILIES) {
    const key = `ANTHROPIC_DEFAULT_${family.name}_MODEL`;
    if (env[key]?.trim()) continue;
    if (bedrock) {
      if (!geo || !family.geographies.includes(geo)) continue;
      // Haiku also services background requests, potentially in another region.
      if (family.name === "HAIKU" && env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION && geography(env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION) !== geo) continue;
      result[key] = `${geo}.anthropic.${family.model}`;
    } else if (["us", "eu", "global"].includes(env[family.vertexRegion] || env.CLOUD_ML_REGION || "")) {
      result[key] = family.model;
    }
  }
  return result;
}
