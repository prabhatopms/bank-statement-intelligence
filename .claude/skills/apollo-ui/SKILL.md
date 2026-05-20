---
name: apollo-ui
description: Design and build UI components using the UiPath Apollo design system. Use this skill whenever building, modifying, or reviewing any frontend UI in this project. Ensures all UI uses Apollo components (apollo-wind, apollo-react) instead of raw HTML/CSS or other component libraries.
---

This skill enforces use of the UiPath Apollo design system for all UI work in this project. Three packages are installed: `@uipath/apollo-wind` (primary — Tailwind + shadcn-style components), `@uipath/apollo-react` (legacy Material UI components, maintenance mode), and `@uipath/apollo-core` (design tokens and CSS variables).

## Package Priority

**Always prefer `@uipath/apollo-wind`** for new UI work. It is actively maintained, uses Tailwind CSS, and has the widest component coverage. Only use `@uipath/apollo-react` material components for features not available in apollo-wind or when working in an existing codebase that already uses them.

## Setup

### apollo-wind (use this for all new UI)

```tsx
// In your app entry (e.g. main.tsx or layout.tsx)
import "@uipath/apollo-wind/tailwind.css";

// tailwind.config.js
export { default as preset } from "@uipath/apollo-wind/tailwind";
```

### apollo-react (legacy / MUI)

```tsx
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
// Pick one: apolloMaterialUiThemeLight | apolloMaterialUiThemeDark | apolloMaterialUiThemeLightHC | apolloMaterialUiThemeDarkHC
import { apolloMaterialUiThemeLight } from '@uipath/apollo-react/material/theme';

<ThemeProvider theme={apolloMaterialUiThemeLight}>
  <CssBaseline />
  {children}
</ThemeProvider>
```

### Design Tokens (direct access)

```tsx
import "@uipath/apollo-core/tokens/css/theme-variables.css";
// Then use: var(--color-primary), var(--spacing-md), var(--font-family-base)

// Or JS tokens:
import { ColorBrandPrimary, SpacingMd } from '@uipath/apollo-core';
```

## apollo-wind Component Catalog

Import all components from `@uipath/apollo-wind`. Use the `cn()` utility for conditional class merging.

```tsx
import { Button, Input, Card, Badge, cn } from "@uipath/apollo-wind";
```

### Forms & Inputs
| Component | Import |
|-----------|--------|
| Input | `import { Input } from "@uipath/apollo-wind"` |
| Textarea | `import { Textarea } from "@uipath/apollo-wind"` |
| Label | `import { Label } from "@uipath/apollo-wind"` |
| Checkbox | `import { Checkbox } from "@uipath/apollo-wind"` |
| RadioGroup, RadioGroupItem | `import { RadioGroup, RadioGroupItem } from "@uipath/apollo-wind"` |
| Select, SelectTrigger, SelectContent, SelectItem | `import { Select, ... } from "@uipath/apollo-wind"` |
| Combobox | `import { Combobox } from "@uipath/apollo-wind"` |
| MultiSelect | `import { MultiSelect } from "@uipath/apollo-wind"` |
| Switch | `import { Switch } from "@uipath/apollo-wind"` |
| Slider | `import { Slider } from "@uipath/apollo-wind"` |
| FileUpload | `import { FileUpload } from "@uipath/apollo-wind"` |
| Search | `import { Search } from "@uipath/apollo-wind"` |
| Calendar | `import { Calendar } from "@uipath/apollo-wind"` |
| DatePicker | `import { DatePicker } from "@uipath/apollo-wind"` |
| DateTimePicker | `import { DateTimePicker } from "@uipath/apollo-wind"` |

### Buttons & Actions
```tsx
import { Button } from "@uipath/apollo-wind";
<Button variant="default" | "destructive" | "outline" | "secondary" | "ghost" | "link">
```

### Layout & Containers
| Component | Import |
|-----------|--------|
| Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription | `import { Card, ... } from "@uipath/apollo-wind"` |
| StatsCard | `import { StatsCard } from "@uipath/apollo-wind"` |
| Row, Column, Grid | `import { Row, Column, Grid } from "@uipath/apollo-wind"` |
| ScrollArea | `import { ScrollArea } from "@uipath/apollo-wind"` |
| ResizablePanelGroup, ResizablePanel, ResizableHandle | `import { ResizablePanelGroup, ... } from "@uipath/apollo-wind"` |
| Separator | `import { Separator } from "@uipath/apollo-wind"` |
| AspectRatio | `import { AspectRatio } from "@uipath/apollo-wind"` |

### Data Display
| Component | Import |
|-----------|--------|
| Table, TableHeader, TableBody, TableRow, TableCell, TableHead | `import { Table, ... } from "@uipath/apollo-wind"` |
| DataTable | `import { DataTable } from "@uipath/apollo-wind"` |
| Badge | `import { Badge } from "@uipath/apollo-wind"` |
| Avatar, AvatarImage, AvatarFallback | `import { Avatar, ... } from "@uipath/apollo-wind"` |
| Skeleton | `import { Skeleton } from "@uipath/apollo-wind"` |
| CodeBlock | `import { CodeBlock } from "@uipath/apollo-wind"` |
| TreeView | `import { TreeView } from "@uipath/apollo-wind"` |
| Pagination | `import { Pagination } from "@uipath/apollo-wind"` |
| Breadcrumb, BreadcrumbItem, BreadcrumbLink | `import { Breadcrumb, ... } from "@uipath/apollo-wind"` |

### Feedback & Overlays
| Component | Import |
|-----------|--------|
| Alert, AlertTitle, AlertDescription | `import { Alert, ... } from "@uipath/apollo-wind"` |
| Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter | `import { Dialog, ... } from "@uipath/apollo-wind"` |
| AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogAction, AlertDialogCancel | `import { AlertDialog, ... } from "@uipath/apollo-wind"` |
| Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle | `import { Sheet, ... } from "@uipath/apollo-wind"` |
| Popover, PopoverTrigger, PopoverContent | `import { Popover, ... } from "@uipath/apollo-wind"` |
| Tooltip, TooltipProvider, TooltipTrigger, TooltipContent | `import { Tooltip, ... } from "@uipath/apollo-wind"` |
| HoverCard, HoverCardTrigger, HoverCardContent | `import { HoverCard, ... } from "@uipath/apollo-wind"` |
| Toast (via sonner) | `import { Toast } from "@uipath/apollo-wind"` |
| Spinner | `import { Spinner } from "@uipath/apollo-wind"` |
| Progress | `import { Progress } from "@uipath/apollo-wind"` |
| EmptyState | `import { EmptyState } from "@uipath/apollo-wind"` |

### Navigation
| Component | Import |
|-----------|--------|
| Tabs, TabsList, TabsTrigger, TabsContent | `import { Tabs, ... } from "@uipath/apollo-wind"` |
| DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem | `import { DropdownMenu, ... } from "@uipath/apollo-wind"` |
| ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem | `import { ContextMenu, ... } from "@uipath/apollo-wind"` |
| Command, CommandInput, CommandList, CommandItem, CommandGroup | `import { Command, ... } from "@uipath/apollo-wind"` |
| Stepper | `import { Stepper } from "@uipath/apollo-wind"` |

### Disclosure
| Component | Import |
|-----------|--------|
| Accordion, AccordionItem, AccordionTrigger, AccordionContent | `import { Accordion, ... } from "@uipath/apollo-wind"` |
| Collapsible, CollapsibleTrigger, CollapsibleContent | `import { Collapsible, ... } from "@uipath/apollo-wind"` |

## apollo-react Component Catalog (Legacy / MUI)

Only use these when apollo-wind doesn't cover the need:

```tsx
import { ApButton, ApTextField, ApModal } from '@uipath/apollo-react';

// Available: ApButton, ApTextField, ApTextArea, ApModal, ApBadge, ApChip,
// ApCheckbox, ApRadio, ApLink, ApTooltip (ApToolTip), ApAccordion, ApMenu,
// ApPopover, ApIconButton, ApProgressSpinner, ApSkeleton, ApIcon,
// ApAlertBar, ApCircularProgress, ApTreeView, ApTypography
```

## Icons

Use icons from `@uipath/apollo-react`:

```tsx
import { AddCanvas, Close, ChevronDown, AlertError } from '@uipath/apollo-react';
// 1,300+ icons available — browse node_modules/@uipath/apollo-core/dist/static/svg/
```

## Design Token Usage

Prefer Apollo CSS variables over hardcoded values:

```css
/* Colors */
var(--color-primary)
var(--color-secondary)
var(--color-error)
var(--color-warning)
var(--color-success)

/* Spacing */
var(--spacing-xs)
var(--spacing-sm)
var(--spacing-md)
var(--spacing-lg)
var(--spacing-xl)

/* Typography */
var(--font-family-base)
var(--font-size-sm)
var(--font-size-md)
var(--font-size-lg)
```

## Rules

1. **Never use raw HTML elements** (`<button>`, `<input>`, `<select>`) when an Apollo component exists for that purpose.
2. **Never import from MUI directly** (`@mui/material`) — always go through `@uipath/apollo-react`.
3. **Never use other UI libraries** (shadcn/ui directly, Radix UI directly, Headless UI, Chakra, etc.) — Apollo Wind wraps these already.
4. **Always use `cn()` from apollo-wind** for conditional Tailwind class merging.
5. **Always wrap the app** with the appropriate ThemeProvider when using apollo-react components.
6. **Prefer apollo-wind for new components**; only fall back to apollo-react for features unavailable in apollo-wind.
7. **Use design tokens** (`var(--color-*)`, `var(--spacing-*)`) instead of arbitrary color/size values in custom CSS.

## Example: Typical Component Pattern

```tsx
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, cn } from "@uipath/apollo-wind";

interface Props {
  title: string;
  status: "active" | "pending" | "error";
  className?: string;
}

export function StatusCard({ title, status, className }: Props) {
  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Badge variant={status === "error" ? "destructive" : status === "active" ? "default" : "secondary"}>
          {status}
        </Badge>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm">View Details</Button>
      </CardContent>
    </Card>
  );
}
```
