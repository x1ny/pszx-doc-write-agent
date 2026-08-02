import * as React from 'react';

import { cn } from '@/lib/utils';

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn('grid gap-4', className)}
      {...props}
    />
  );
}

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field"
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="field-label"
      className={cn(
        'text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function FieldError({ className, ...props }: React.ComponentProps<'p'>) {
  if (!props.children) {
    return null;
  }

  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn('text-xs text-destructive', className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel };
