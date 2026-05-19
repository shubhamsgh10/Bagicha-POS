# Mobile Responsive — Conversion Patterns

All 10 patterns with before/after code. Read the relevant section before writing code.

---

## 1. Container Pattern

**Before:**
```tsx
<div className="max-w-7xl mx-auto p-8">
```

**After:**
```tsx
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
```

---

## 2. Grid Pattern

**Before:**
```tsx
<div className="grid grid-cols-4 gap-6">
```

**After:**
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
```

---

## 3. Table → Card Pattern

**Before:**
```tsx
<table className="w-full">
  <thead>
    <tr><th>Name</th><th>Email</th><th>Actions</th></tr>
  </thead>
  <tbody>
    <tr><td>John</td><td>john@example.com</td><td><button>Edit</button></td></tr>
  </tbody>
</table>
```

**After:**
```tsx
{/* Desktop Table */}
<div className="hidden md:block overflow-x-auto">
  <table className="w-full">
    <thead>
      <tr><th>Name</th><th>Email</th><th>Actions</th></tr>
    </thead>
    <tbody>
      <tr><td>John</td><td>john@example.com</td><td><button>Edit</button></td></tr>
    </tbody>
  </table>
</div>

{/* Mobile Cards */}
<div className="md:hidden space-y-3">
  <div className="bg-white rounded-lg p-4 shadow-sm border">
    <div className="flex justify-between items-start mb-2">
      <span className="font-semibold">John</span>
      <button className="min-h-[44px] min-w-[44px] p-2">Edit</button>
    </div>
    <p className="text-sm text-gray-600">john@example.com</p>
  </div>
</div>
```

---

## 4. Form Pattern

**Before:**
```tsx
<div className="flex gap-4">
  <input className="w-64" placeholder="Search..." />
  <button>Submit</button>
</div>
```

**After:**
```tsx
<div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
  <input className="w-full sm:w-64" placeholder="Search..." />
  <button className="w-full sm:w-auto min-h-[44px] px-4">Submit</button>
</div>
```

---

## 5. Header + Bottom Nav Pattern

**Before:**
```tsx
<header className="flex justify-between items-center p-4">
  <Logo />
  <nav className="flex gap-4">
    <Link href="/">Home</Link>
    <Link href="/products">Products</Link>
    <Link href="/settings">Settings</Link>
  </nav>
</header>
```

**After:**
```tsx
<header className="flex justify-between items-center p-4">
  <Logo />

  {/* Desktop Nav */}
  <nav className="hidden md:flex gap-4">
    <Link href="/">Home</Link>
    <Link href="/products">Products</Link>
    <Link href="/settings">Settings</Link>
  </nav>

  {/* Mobile Menu Button (optional if using bottom nav) */}
  <button className="md:hidden p-2 min-w-[44px] min-h-[44px]">
    <MenuIcon className="w-5 h-5" />
  </button>
</header>

{/* Mobile Bottom Navigation */}
<nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-50 flex justify-around py-2">
  <Link href="/" className="flex flex-col items-center p-2 min-w-[64px]">
    <HomeIcon className="w-6 h-6" />
    <span className="text-xs mt-1">Home</span>
  </Link>
  <Link href="/products" className="flex flex-col items-center p-2 min-w-[64px]">
    <ShoppingBagIcon className="w-6 h-6" />
    <span className="text-xs mt-1">Products</span>
  </Link>
  <Link href="/settings" className="flex flex-col items-center p-2 min-w-[64px]">
    <SettingsIcon className="w-6 h-6" />
    <span className="text-xs mt-1">Settings</span>
  </Link>
</nav>

{/* REQUIRED: pad main content so bottom nav doesn't overlap */}
{/* Add to your <main>: className="pb-20 md:pb-0" */}
```

---

## 6. Modal Pattern

**Before:**
```tsx
<Dialog className="w-[600px]">
  <DialogContent>...</DialogContent>
</Dialog>
```

**After:**
```tsx
<Dialog>
  <DialogContent className="w-full max-w-[600px] mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto">
    ...
  </DialogContent>
</Dialog>
```

---

## 7. Typography Pattern

**Before:**
```tsx
<h1 className="text-4xl font-bold">Dashboard</h1>
<h2 className="text-2xl font-semibold">Overview</h2>
<p className="text-lg text-gray-600">Description text here</p>
```

**After:**
```tsx
<h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold">Dashboard</h1>
<h2 className="text-xl sm:text-2xl font-semibold">Overview</h2>
<p className="text-base sm:text-lg text-gray-600">Description text here</p>
```

---

## 8. Button Group Pattern

**Before:**
```tsx
<div className="flex gap-2 justify-end">
  <button>Cancel</button>
  <button>Save Changes</button>
</div>
```

**After:**
```tsx
<div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
  <button className="w-full sm:w-auto min-h-[44px] px-4 py-2 border rounded-md">
    Cancel
  </button>
  <button className="w-full sm:w-auto min-h-[44px] px-4 py-2 bg-primary text-white rounded-md">
    Save Changes
  </button>
</div>
```

> Note: `flex-col-reverse` puts the primary action on top on mobile (visually last = most prominent).

---

## 9. Sidebar Pattern

**Before:**
```tsx
<div className="flex">
  <aside className="w-64 bg-white border-r">Sidebar</aside>
  <main className="flex-1">Content</main>
</div>
```

**After:**
```tsx
'use client'
import { useState } from 'react'

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex">
      {/* Sidebar */}
      <aside className={`
        fixed lg:relative inset-y-0 left-0 z-50
        w-64 bg-white border-r
        transform transition-transform duration-200 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0
      `}>
        <div className="p-4">Sidebar content</div>
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 min-h-screen">
        {/* Mobile toggle button */}
        <button
          className="lg:hidden m-4 p-2 min-h-[44px] min-w-[44px] border rounded-md"
          onClick={() => setOpen(true)}
        >
          <MenuIcon className="w-5 h-5" />
        </button>
        {children}
      </main>
    </div>
  )
}
```

---

## 10. Image Pattern

**Before:**
```tsx
<img src="/image.jpg" width={400} height={300} className="rounded-lg" />
```

**After:**
```tsx
{/* Option A — full-width responsive */}
<div className="relative w-full aspect-[4/3]">
  <Image
    src="/image.jpg"
    fill
    className="object-cover rounded-lg"
    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
    alt="Description"
  />
</div>

{/* Option B — constrained width, responsive fallback */}
<Image
  src="/image.jpg"
  width={400}
  height={300}
  className="w-full sm:w-[400px] h-auto rounded-lg"
  sizes="(max-width: 640px) 100vw, 400px"
  alt="Description"
/>
```
