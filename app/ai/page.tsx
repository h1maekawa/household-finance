import { redirect } from 'next/navigation'

// /ai は AI Coach 専用ページ(/coach)へ統合した。
// 以前は /plan へ寄せていたが、コーチは独立した役割なので /coach を正とする。
export default function Page() {
  redirect('/coach')
}
