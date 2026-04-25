import { cn } from '@/lib/utils';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      )}
      <input
        className={cn(
          'w-full px-3 py-2 text-sm rounded-lg transition-colors duration-200',
          'border border-violet-100 dark:border-violet-400/[0.12]',
          'bg-white dark:bg-white/[0.04]',
          'text-slate-950 dark:text-white',
          'focus:outline-none focus:ring-2 focus:ring-accent/45 focus:border-accent',
          'placeholder:text-gray-400 dark:placeholder:text-gray-500',
          className
        )}
        {...props}
      />
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className, ...props }: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      )}
      <textarea
        className={cn(
          'w-full px-3 py-2 text-sm rounded-lg transition-colors duration-200 resize-none',
          'border border-violet-100 dark:border-violet-400/[0.12]',
          'bg-white dark:bg-white/[0.04]',
          'text-slate-950 dark:text-white',
          'focus:outline-none focus:ring-2 focus:ring-accent/45 focus:border-accent',
          'placeholder:text-gray-400 dark:placeholder:text-gray-500',
          className
        )}
        {...props}
      />
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({ label, className, children, ...props }: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      )}
      <select
        className={cn(
          'w-full px-3 py-2 text-sm rounded-lg transition-colors duration-200',
          'border border-violet-100 dark:border-violet-400/[0.12]',
          'bg-white dark:bg-white/[0.04]',
          'text-slate-950 dark:text-white',
          'focus:outline-none focus:ring-2 focus:ring-accent/45 focus:border-accent',
          className
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
