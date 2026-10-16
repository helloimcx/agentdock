import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Slot } from '@radix-ui/react-slot';
import { buttonContent } from '../../src/components/ui/button-content.js';

test('Button asChild forwards one element to Radix Slot when not loading', () => {
  const anchor = React.createElement('a', { href: '#task' }, 'Open task');
  const spinner = React.createElement('span', null, 'loading');
  const element = React.createElement(Slot, null, buttonContent(anchor, false, spinner));
  assert.equal(renderToStaticMarkup(element), '<a href="#task">Open task</a>');
});
