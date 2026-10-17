import { createElement, Fragment, type ReactNode } from 'react';

export function buttonContent(children: ReactNode, loading: boolean, spinner: ReactNode): ReactNode {
  return loading ? createElement(Fragment, null, spinner, children) : children;
}
