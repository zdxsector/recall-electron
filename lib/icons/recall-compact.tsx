import React from 'react';

export default function RecallCompactLogo() {
  return (
    <svg className="logo" width="96" height="96" viewBox="0 0 176 176">
      <g fill="#4895d9">
        {/* Large red/orange block - top left */}
        <rect x="18" y="18" width="70" height="58" rx="4" />

        {/* Green block - overlapping */}
        <rect x="48" y="48" width="45" height="55" rx="4" />

        {/* Orange block - top right */}
        <rect x="108" y="28" width="38" height="32" rx="3" />

        {/* Yellow block - left side */}
        <rect x="28" y="88" width="28" height="24" rx="3" />

        {/* Blue block - right side */}
        <rect x="98" y="78" width="60" height="38" rx="4" />

        {/* Purple block - bottom center */}
        <rect x="58" y="118" width="48" height="40" rx="4" />

        {/* Small green square - bottom left */}
        <rect x="38" y="128" width="12" height="12" rx="2" />

        {/* Small purple square - lower left */}
        <rect x="18" y="118" width="14" height="14" rx="2" />

        {/* Small yellow square - mid left */}
        <rect x="8" y="78" width="16" height="14" rx="2" />

        {/* Small red square - bottom right */}
        <rect x="138" y="128" width="14" height="14" rx="2" />

        {/* Tiny accent square */}
        <rect x="118" y="118" width="10" height="10" rx="2" />
      </g>
    </svg>
  );
}
