# Mobile Responsive — Page Templates

Copy-paste templates for new mobile-first pages and components.

---

## Full Page Template

```tsx
// app/example/page.tsx
export default function ExamplePage() {
  return (
    <div className="min-h-screen bg-gray-50">

      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-white border-b">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <h1 className="text-lg sm:text-xl font-semibold truncate">Page Title</h1>
          <div className="flex items-center gap-2">
            <button className="min-h-[44px] min-w-[44px] p-2">
              {/* Action icon */}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content — pb-24 leaves room for mobile bottom nav */}
      <main className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8 pb-24 md:pb-6">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* Stats row — collapses to 2-col on mobile */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* stat cards */}
          </div>

          {/* Content section */}
          <div className="bg-white rounded-lg border p-4 sm:p-6">
            {/* content */}
          </div>

        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-50">
        <div className="flex justify-around py-2">
          {/* Nav items — see patterns.md #5 for full example */}
        </div>
      </nav>

    </div>
  )
}
```

---

## Responsive Data List Component

```tsx
// components/ResponsiveDataList.tsx
interface Column<T> {
  key: string
  label: string
  render?: (item: T) => React.ReactNode
}

interface Props<T> {
  items: T[]
  columns: Column<T>[]
  renderMobileCard: (item: T, index: number) => React.ReactNode
  keyExtractor: (item: T) => string
}

export function ResponsiveDataList<T>({ items, columns, renderMobileCard, keyExtractor }: Props<T>) {
  return (
    <>
      {/* Desktop Table */}
      <div className="hidden md:block overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {columns.map(col => (
                <th key={col.key} className="px-4 py-3 text-left font-medium text-gray-600">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y bg-white">
            {items.map(item => (
              <tr key={keyExtractor(item)} className="hover:bg-gray-50 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3">
                    {col.render ? col.render(item) : String((item as any)[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {items.map((item, index) => renderMobileCard(item, index))}
      </div>
    </>
  )
}
```

**Usage example:**
```tsx
<ResponsiveDataList
  items={orders}
  keyExtractor={(o) => o.id}
  columns={[
    { key: 'name', label: 'Customer' },
    { key: 'total', label: 'Total', render: (o) => `₹${o.total}` },
    { key: 'status', label: 'Status' },
  ]}
  renderMobileCard={(order) => (
    <div className="bg-white rounded-lg border p-4 space-y-2">
      <div className="flex justify-between items-center">
        <span className="font-semibold">{order.name}</span>
        <span className="text-sm text-gray-500">{order.status}</span>
      </div>
      <p className="text-lg font-bold">₹{order.total}</p>
    </div>
  )}
/>
```

---

## Responsive Form Section

```tsx
// Standard search + action bar
<div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">

  {/* Search */}
  <div className="relative flex-1 sm:max-w-xs">
    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
    <input
      className="w-full pl-9 pr-3 py-2 min-h-[44px] border rounded-md text-sm"
      placeholder="Search..."
    />
  </div>

  {/* Action buttons */}
  <div className="flex gap-2">
    <button className="flex-1 sm:flex-none min-h-[44px] px-4 border rounded-md text-sm">
      Filter
    </button>
    <button className="flex-1 sm:flex-none min-h-[44px] px-4 bg-primary text-white rounded-md text-sm">
      + Add New
    </button>
  </div>

</div>
```

---

## Utility Class Reference

```
VISIBILITY
  hidden sm:block          Show only on sm+
  block sm:hidden          Show only on mobile
  hidden md:flex           Show as flex on md+

FLEX
  flex-col sm:flex-row     Stack → row
  flex-col-reverse sm:flex-row   Row-reverse → normal
  items-start sm:items-center

WIDTH
  w-full sm:w-auto         Full → auto
  w-full sm:w-64           Full → fixed

PADDING
  px-4 sm:px-6 lg:px-8    Responsive horizontal
  py-4 sm:py-6             Responsive vertical
  pb-20 md:pb-0            Bottom nav clearance

GRID
  grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
  gap-3 sm:gap-4 lg:gap-6

TEXT
  text-sm sm:text-base     Responsive body
  text-xl sm:text-2xl lg:text-3xl
  text-2xl sm:text-3xl lg:text-4xl   H1

TOUCH
  min-h-[44px] min-w-[44px]   Minimum tap target
  touch-manipulation           Prevent double-tap zoom
```
