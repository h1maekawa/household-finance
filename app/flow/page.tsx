import Link from 'next/link'

const transactions = [
  { icon: '食', name: 'スーパー丸伊', method: '楽天カード', meta: '7/3 (金) ・ 食費', amount: '-¥3,240', tone: 'down', color: 'coral' },
  { icon: '住', name: '家賃', method: '口座振替', meta: '7/25予定 ・ 固定費', amount: '-¥80,000', tone: 'down', color: 'brand' },
  { icon: '給', name: '給与振込', method: '', meta: '7/25予定', amount: '+¥300,000', tone: 'up', color: 'mint' },
  { icon: '通', name: '携帯電話', method: '三井住友カード', meta: '7/15予定 ・ 固定費', amount: '-¥9,000', tone: 'down', color: 'neutral' },
]

const holdings = [
  { ticker: 'NVDA', name: 'NVIDIA Corp', market: 'US', qty: '12', cost: '$118.40', price: '$142.85', pnl: '+$293.40 (+20.6%)', tone: 'up' },
  { ticker: '7203', name: 'トヨタ自動車', market: 'JP', qty: '100', cost: '¥2,800', price: '¥3,150', pnl: '+¥35,000 (+12.5%)', tone: 'jp-up' },
  { ticker: '8035', name: '東京エレクトロン', market: 'JP', qty: '20', cost: '¥28,400', price: '¥26,900', pnl: '-¥30,000 (-5.3%)', tone: 'jp-down' },
]

const heatmap = [
  { sector: '半導体', pct: '+2.4%', tone: 'up', opacity: 'opacity-100' },
  { sector: 'ヘルスケア', pct: '+0.6%', tone: 'up', opacity: 'opacity-60' },
  { sector: 'エネルギー', pct: '-1.1%', tone: 'down', opacity: 'opacity-100' },
  { sector: '金融', pct: '+0.2%', tone: 'up', opacity: 'opacity-40' },
  { sector: '生活必需品', pct: '-2.0%', tone: 'down', opacity: 'opacity-90' },
  { sector: '資本財', pct: '+1.3%', tone: 'up', opacity: 'opacity-80' },
]

const news = [
  { headline: 'NVIDIA、次世代GPUの量産前倒しを示唆', meta: 'Bloomberg ・ 06:12 ・ 重要度 92', tag: 'NVDA', high: true },
  { headline: 'FRB高官、利下げ時期に慎重姿勢', meta: 'Reuters ・ 05:03 ・ 重要度 61', tag: 'マクロ', high: false },
]

export default function FlowMockupPage() {
  return (
    <div className="min-h-svh bg-[#F4F6F9] text-[#1E2933] lg:flex">
      <aside className="hidden lg:block w-[200px] shrink-0 bg-white border-r border-[#E6EAEF] px-3.5 py-6">
        <div className="px-2.5 pb-6 text-base font-bold">Flow<span className="text-[#1476B3]">+</span></div>
        <SidebarItem label="ホーム" active />
        <SidebarItem label="家計簿" />
        <SidebarItem label="資産運用" />
        <Link href="/flow/setup" className="mt-5 block px-3 py-2 text-xs text-[#1476B3]">初期設定</Link>
        <Link href="/dashboard" className="block px-3 py-2 text-xs text-[#8891A0]">通常版へ戻る</Link>
      </aside>

      <main className="mx-auto w-full max-w-[1080px] px-4 py-6 pb-24 lg:px-10 lg:py-8">
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <div>
            <p className="text-xs text-[#8891A0] lg:hidden">Flow+</p>
            <h1 className="text-xl font-bold">ホーム</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/flow/setup" className="rounded-full border border-[#E6EAEF] bg-white px-3 py-1.5 text-xs font-medium text-[#1476B3]">初期設定</Link>
            <span className="font-mono text-xs text-[#8891A0]">2026.07.03 (金)</span>
          </div>
        </div>

        <section className="rounded-[14px] border border-[#E6EAEF] bg-white px-5 py-5 lg:px-6">
          <p className="text-xs text-[#8891A0]">純資産合計（現金＋投資）</p>
          <p className="mt-1 font-mono text-3xl font-medium lg:text-[34px]">¥6,842,300</p>
          <p className="mt-1 font-mono text-sm text-[#1FAE8C]">先月比 +¥312,400 (+4.8%)</p>
          <div className="mt-5">
            <svg viewBox="0 0 600 140" width="100%" height="140" preserveAspectRatio="none" aria-hidden="true">
              <polyline points="0,110 100,95 200,100 300,72 400,55 500,42" fill="none" stroke="#1476B3" strokeWidth="2.5" />
              <polyline points="500,42 560,32 600,26" fill="none" stroke="#1476B3" strokeWidth="2.5" strokeDasharray="5,5" />
              <circle cx="500" cy="42" r="3.5" fill="#1476B3" />
            </svg>
            <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-[#8891A0]">
              <LegendLine label="実績" />
              <LegendLine label="予測（未確定請求・固定費を反映）" faded />
            </div>
          </div>
        </section>

        <section className="my-4 grid gap-3 lg:grid-cols-3">
          <Metric label="今月あと使える金額" value="¥84,600" />
          <Metric label="未確定請求額" value="¥62,300" />
          <Metric label="投資評価損益" value="+¥612,940" tone="up" />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card title="今月の支出内訳">
            <div className="flex items-center gap-5">
              <div className="relative h-[120px] w-[120px] shrink-0 rounded-full bg-[conic-gradient(#E2544B_0%_34%,#1476B3_34%_58%,#1FAE8C_58%_76%,#E6EAEF_76%_100%)] after:absolute after:inset-5 after:rounded-full after:bg-white" />
              <div className="flex-1 text-xs">
                <Breakdown color="#E2544B" label="食費" amount="¥48,200" />
                <Breakdown color="#1476B3" label="固定費" amount="¥89,000" />
                <Breakdown color="#1FAE8C" label="交際費" amount="¥25,800" />
                <Breakdown color="#E6EAEF" label="その他" amount="¥34,100" />
              </div>
            </div>
          </Card>

          <Card title="資産の内訳">
            <div className="mt-1 flex h-3.5 overflow-hidden rounded-full">
              <div className="w-[34%] bg-[#1476B3]" />
              <div className="w-[66%] bg-[#1FAE8C]" />
            </div>
            <Breakdown color="#1476B3" label="現金・預金" amount="¥2,326,000" />
            <Breakdown color="#1FAE8C" label="投資評価額" amount="¥4,516,300" />
          </Card>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="家計簿">
            <div className="mb-4 flex gap-2 overflow-x-auto">
              {['すべて', '固定費', '変動費', '未確定'].map((chip, index) => (
                <span key={chip} className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs ${index === 0 ? 'border-[#1476B3] bg-[#1476B3] text-white' : 'border-[#E6EAEF] text-[#8891A0]'}`}>{chip}</span>
              ))}
            </div>
            {transactions.map(tx => <TransactionRow key={`${tx.name}-${tx.meta}`} tx={tx} />)}
          </Card>

          <Card title="マーケットセッション">
            <div className="relative mt-6 h-[30px] overflow-hidden rounded-md bg-[#F0F3F7]">
              <MarketSegment className="left-0 w-[25%] bg-[#1476B3]/15 text-[#1476B3]" label="NYSE" />
              <MarketSegment className="left-[37.5%] w-[10.4%] bg-[#C23B4B]/15 text-[#C23B4B]" label="TSE" />
              <MarketSegment className="left-[52.1%] w-[10.4%] bg-[#C23B4B]/15 text-[#C23B4B]" label="TSE" />
              <div className="absolute -top-1 -bottom-1 left-[44.7%] w-0.5 bg-[#1E2933]" />
              <span className="absolute -top-5 left-[44.7%] -translate-x-1/2 text-[9px] text-[#1E2933]">現在</span>
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[9px] text-[#8891A0]">
              <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
            </div>
          </Card>
        </section>

        <section className="mt-4">
          <Card title="保有銘柄">
            <p className="-mt-2 mb-3 text-[11px] text-[#8891A0]">米国株：緑=上昇 / 赤=下落　日本株：赤=上昇 / 青=下落</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] font-normal text-[#8891A0]">
                    <th className="pb-2 pr-2">銘柄</th><th className="pb-2 px-2">市場</th><th className="pb-2 px-2 text-right">数量</th><th className="pb-2 px-2 text-right">取得単価</th><th className="pb-2 px-2 text-right">現在値</th><th className="pb-2 pl-2 text-right">評価損益</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(item => <HoldingRow key={item.ticker} item={item} />)}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="セクターヒートマップ（米国株）">
            <div className="grid grid-cols-3 gap-1.5">
              {heatmap.map(cell => (
                <div key={cell.sector} className={`rounded-lg p-2 text-[11px] ${cell.tone === 'up' ? 'bg-[#E3F5F0]' : 'bg-[#FBEAE9]'} ${cell.opacity}`}>
                  {cell.sector}
                  <span className={`mt-1 block font-mono text-[13px] ${cell.tone === 'up' ? 'text-[#1FAE8C]' : 'text-[#E2544B]'}`}>{cell.pct}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="ニュースフィード">
            {news.map(item => (
              <div key={item.headline} className="flex gap-3 border-t border-[#E6EAEF] py-3 first:border-t-0 first:pt-0">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.high ? 'bg-[#1476B3]' : 'bg-[#8891A0]'}`} />
                <div>
                  <p className="text-[13.5px] leading-6">{item.headline}</p>
                  <p className="mt-1 font-mono text-[11px] text-[#8891A0]">{item.meta}</p>
                  <span className="mt-1.5 inline-block rounded bg-[#F0F3F7] px-2 py-0.5 text-[10px] text-[#8891A0]">{item.tag}</span>
                </div>
              </div>
            ))}
          </Card>
        </section>
      </main>
    </div>
  )
}

function SidebarItem({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className={`mb-1 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] ${active ? 'bg-[#E8F2FA] font-medium text-[#1476B3]' : 'text-[#8891A0]'}`}>
      <span className={`h-2 w-2 rounded-sm ${active ? 'bg-[#1476B3]' : 'bg-[#E6EAEF]'}`} />
      {label}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-[#E6EAEF] bg-white px-5 py-5 lg:px-6">
      <h2 className="mb-4 text-[13px] font-bold">{title}</h2>
      {children}
    </section>
  )
}

function LegendLine({ label, faded }: { label: string; faded?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-0.5 w-3.5 bg-[#1476B3] ${faded ? 'opacity-40' : ''}`} />
      {label}
    </span>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' }) {
  return (
    <div className="rounded-[14px] border border-[#E6EAEF] bg-white px-4 py-4">
      <p className="mb-2 text-[11px] text-[#8891A0]">{label}</p>
      <p className={`font-mono text-[19px] font-medium ${tone === 'up' ? 'text-[#1FAE8C]' : ''}`}>{value}</p>
    </div>
  )
}

function Breakdown({ color, label, amount }: { color: string; label: string; amount: string }) {
  return (
    <div className="flex justify-between py-1 text-xs text-[#8891A0]">
      <span><span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: color }} />{label}</span>
      <span className="font-mono text-[#1E2933]">{amount}</span>
    </div>
  )
}

function TransactionRow({ tx }: { tx: typeof transactions[number] }) {
  const colorClass = tx.color === 'coral'
    ? 'bg-[#FBEAE9] text-[#E2544B]'
    : tx.color === 'brand'
      ? 'bg-[#E8F2FA] text-[#1476B3]'
      : tx.color === 'mint'
        ? 'bg-[#E3F5F0] text-[#1FAE8C]'
        : 'bg-[#F0F3F7] text-[#8891A0]'

  return (
    <div className="flex items-center gap-3 border-t border-[#E6EAEF] py-3 first:border-t-0">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold ${colorClass}`}>{tx.icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{tx.name}{tx.method && <span className="ml-2 rounded bg-[#F0F3F7] px-2 py-0.5 text-[10px] text-[#8891A0]">{tx.method}</span>}</p>
        <p className="mt-0.5 text-[11px] text-[#8891A0]">{tx.meta}</p>
      </div>
      <p className={`shrink-0 font-mono text-sm ${tx.tone === 'up' ? 'text-[#1FAE8C]' : 'text-[#E2544B]'}`}>{tx.amount}</p>
    </div>
  )
}

function MarketSegment({ className, label }: { className: string; label: string }) {
  return <div className={`absolute top-0 bottom-0 flex items-center pl-1.5 text-[10px] ${className}`}>{label}</div>
}

function HoldingRow({ item }: { item: typeof holdings[number] }) {
  const toneClass = item.tone === 'up'
    ? 'text-[#1FAE8C]'
    : item.tone === 'jp-up'
      ? 'text-[#C23B4B]'
      : 'text-[#3E6FA0]'
  const marketClass = item.market === 'US' ? 'bg-[#E8F2FA] text-[#1476B3]' : 'bg-[#FBEAE9] text-[#C23B4B]'

  return (
    <tr>
      <td className="border-t border-[#E6EAEF] py-2.5 pr-2">
        <span className="font-mono font-medium">{item.ticker}</span>
        <span className="mt-0.5 block text-[11px] text-[#8891A0]">{item.name}</span>
      </td>
      <td className="border-t border-[#E6EAEF] px-2 py-2.5">
        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${marketClass}`}>{item.market}</span>
      </td>
      <td className="border-t border-[#E6EAEF] px-2 py-2.5 text-right font-mono">{item.qty}</td>
      <td className="border-t border-[#E6EAEF] px-2 py-2.5 text-right font-mono">{item.cost}</td>
      <td className="border-t border-[#E6EAEF] px-2 py-2.5 text-right font-mono">{item.price}</td>
      <td className={`border-t border-[#E6EAEF] py-2.5 pl-2 text-right font-mono ${toneClass}`}>{item.pnl}</td>
    </tr>
  )
}
