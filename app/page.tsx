import { Suspense } from 'react'
import FlowSetupWizard from '@/components/FlowSetupWizard'

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <FlowSetupWizard />
    </Suspense>
  )
}
