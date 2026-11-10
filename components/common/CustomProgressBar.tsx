"use client";
import React from "react";

type Props = {
  now: number;
  min?: number;
  max?: number;
  label?: React.ReactNode;
  visuallyHidden?: boolean;
  striped?: boolean;
  animated?: boolean;
  variant?:
    | "primary"
    | "secondary"
    | "success"
    | "danger"
    | "warning"
    | "info"
    | "light"
    | "dark"
    | string;
  style?: React.CSSProperties;
  className?: string;
};

const CustomProgressBar: React.FC<Props> = ({
  now,
  min = 0,
  max = 100,
  label,
  visuallyHidden = false,
  striped = false,
  animated = false,
  variant,
  style,
  className = "",
}) => {
  const percentage = Math.min(
    Math.max(((now - min) / (max - min)) * 100, 0),
    100
  );

  let barClass = "progress-bar";
  if (variant) barClass += ` bg-${variant}`;
  if (striped) barClass += " progress-bar-striped";
  if (animated) barClass += " progress-bar-animated";
  if (visuallyHidden) barClass += " visually-hidden";

  return (
    <div className={`progress ${className}`} style={style}>
      <div
        className={barClass}
        role="progressbar"
        style={{ width: `${percentage}%` }}
        aria-valuenow={now}
        aria-valuemin={min}
        aria-valuemax={max}
      >
        {!visuallyHidden && label}
      </div>
    </div>
  );
};

export default CustomProgressBar;
