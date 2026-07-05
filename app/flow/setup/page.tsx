import { Suspense } from 'react'
import FlowSetupWizard from '@/components/FlowSetupWizard'

export default function FlowSetupPage() {
  return (
    <Suspense fallback={null}>
      <FlowSetupWizard />
    </Suspense>
  )
}
