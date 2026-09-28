export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

const control = 'inline-flex items-center justify-center gap-2 cursor-pointer rounded-md border border-line bg-raised text-strong no-underline transition-[background,border-color,transform] duration-150 hover:border-line-strong hover:bg-control-hover active:translate-y-px disabled:translate-none disabled:cursor-not-allowed disabled:opacity-[.48] [&_svg]:size-[15px] [&_svg]:shrink-0'

export const button = `${control} min-h-9 px-[13px]`
export const buttonSmall = 'min-h-[31px] px-[11px] text-[11px]'
export const buttonPrimary = 'border-green-border bg-green-soft text-green-strong hover:border-green-border hover:bg-green-soft'
export const buttonDanger = 'border-red-border bg-red-soft text-red-text hover:border-red-border hover:bg-red-soft'
export const buttonDangerSubtle = 'border-red-border bg-transparent text-red-text hover:bg-red-soft'
export const buttonCopied = 'border-green-border bg-green-soft text-green-strong'
export const iconButton = `${control} size-9 p-0`
export const iconButtonDangerSubtle = 'border-transparent bg-transparent text-red-text hover:border-red-border hover:bg-red-soft'
