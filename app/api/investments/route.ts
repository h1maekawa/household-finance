import { getInvestmentSummary, sampleInvestmentData } from '@/lib/investments'

export async function GET() {
  return Response.json({
    summary: getInvestmentSummary(sampleInvestmentData),
    updatedAt: new Date().toISOString(),
  })
}
