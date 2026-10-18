import { cn } from '@/lib/utils';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Children, isValidElement } from 'react';
import type { ChangeEvent, ReactElement, ReactNode, SelectHTMLAttributes } from 'react';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'onChange' | 'size'> {
  label?: string;
  children?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
}

const emptySelectValue = '__radix_empty_value__';

function optionText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return Children.toArray(children).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return '';
  }).join('');
}

function getSelectOptions(children: ReactNode) {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as ReactElement<{
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    }>;
    if (element.type !== 'option') return [];
    const rawValue = element.props.value ?? optionText(element.props.children);
    return [{
      value: String(rawValue),
      label: optionText(element.props.children),
      disabled: element.props.disabled,
    }];
  });
}

function toRadixValue(value: unknown) {
  return value === '' || value === undefined || value === null ? emptySelectValue : String(value);
}

function fromRadixValue(value: string) {
  return value === emptySelectValue ? '' : value;
}

export function Select({ label, className, children, ...props }: SelectProps) {
  const options = getSelectOptions(children);
  const selectedValue = toRadixValue(props.value ?? props.defaultValue ?? '');
  const selectedOption = options.find((option) => option.value === fromRadixValue(selectedValue));
  const placeholder = options.find((option) => option.value === '')?.label;
  const handleValueChange = (nextValue: string) => {
    const value = fromRadixValue(nextValue);
    props.onChange?.({
      target: { value },
      currentTarget: { value },
    } as ChangeEvent<HTMLSelectElement>);
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-foreground">{label}</label>
      )}
      <SelectPrimitive.Root
        value={selectedValue}
        onValueChange={handleValueChange}
        disabled={props.disabled}
        name={props.name}
      >
        <SelectPrimitive.Trigger
          id={props.id}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
            className
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder}>
            {selectedOption?.label}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-fade-in">
            <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
              <ChevronUp className="h-4 w-4" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={`${option.value}-${option.label}`}
                  value={toRadixValue(option.value)}
                  disabled={option.disabled}
                  className={cn(
                    'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none',
                    'focus:bg-accent/10 focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50'
                  )}
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="h-4 w-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
              <ChevronDown className="h-4 w-4" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
