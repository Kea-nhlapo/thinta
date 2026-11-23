import React from 'react';

export default function Brand({ light = false, href = '#top', label = 'SA Educate home' }) {
  return <a className={`brand ${light ? 'brand-light' : ''}`} href={href} aria-label={label}>
    <svg viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="7" r="5" fill="currentColor"/><path d="M25 17c-7-7-17-7-22-4v26c8-1 16 1 22 7V17Zm0 0c7-7 17-7 22-4v26c-8-1 16-1 22 7V17Z" fill="currentColor"/><path d="M25 18v27" stroke="#fff" strokeWidth="2"/></svg>
    <span>SA Educate</span>
  </a>;
}
