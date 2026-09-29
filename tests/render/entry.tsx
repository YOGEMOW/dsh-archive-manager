/**
 * Entry for the jsdom render harness. It re-exports what the test drives so the
 * test file itself stays plain JavaScript.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ArchiveManagerSection } from '../../src/client/ArchiveManagerSection.tsx'
import { en, zh } from '../../src/client/locales.ts'

/** React 18.3 exports `act`; older 18.x keeps it in react-dom/test-utils. */
const act = React.act ?? (await import('react-dom/test-utils')).act

export { React, act, createRoot, ArchiveManagerSection, en, zh }
