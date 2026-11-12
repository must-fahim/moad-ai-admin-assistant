export function GET() {
  return Response.json({
    supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    ai: Boolean(process.env.AI_API_KEY),
  });
}
