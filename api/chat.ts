import handler from "./_chat/handler";

// Vercel reads the runtime from this file only; a re-exported config is not
// detected, which would deploy the chatbot as a Node function that cannot
// resolve the extensionless imports. Helpers live in _chat/ because Vercel
// turns every non-underscored file under api/ into its own endpoint.
export const config = { runtime: "edge" };

export default handler;
