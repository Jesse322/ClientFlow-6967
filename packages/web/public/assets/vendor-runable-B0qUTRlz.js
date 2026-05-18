import{a as i}from"./vendor-react-BIo4hZ6n.js";import{w as n,m as a}from"./vendor-misc-Co_zwRAr.js";const d=new Set(["P","SPAN","A","LABEL","H1","H2","H3","H4","H5","H6","LI","TD","TH","BLOCKQUOTE","PRE","CODE","EM","STRONG","SMALL","SUB","SUP","ABBR","CITE","Q","DFN","TIME","MARK"]);["* { cursor: crosshair !important; }",`${[...d].map(r=>r.toLowerCase()).join(", ")} { cursor: text !important; }`,"[data-runable-interactive], [data-runable-interactive] * { cursor: pointer !important; }","[data-runable-ignore], [data-runable-ignore] * { cursor: auto !important; }","[data-runable-badge], [data-runable-badge] * { cursor: pointer !important; }"].join(`
`);i.createContext(null);const e={primary:"oklch(0.8489 0.146 208.1)",primaryForeground:"oklch(0 0 0)",foreground:"oklch(1 0 89.9 / 0.8)",mutedForeground:"#7E7E7E",popover:"#282828",secondary700:"#303030",secondary800:"#282828",secondary200:"#c3c3c3",secondary100:"#ededed",secondary500:"#383838",secondary900:"#212121",border:"#333333",accent:"oklch(1 0 89.9 / 0.039)",font:"system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"};a(i.createElement);const t=typeof document>"u"?null:document.createElement("div"),o=t?n.bind({target:t}):n;o("div")`
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 12px;
  border: 0.5px solid ${e.border};
  background-color: ${e.popover};
  padding: 8px;
  font-family: ${e.font};
  box-sizing: border-box;
  * {
    box-sizing: border-box;
  }
`;o("div")`
  overflow-x: auto;
`;o("div")`
  display: flex;
  gap: 8px;
  padding: 8px 6px 2px 0;
`;o("div")`
  position: relative;
  flex-shrink: 0;
  &:hover .remove-btn {
    display: flex;
  }
  &:hover .index-badge {
    display: none;
  }
`;o("img")`
  height: 56px;
  width: 56px;
  border-radius: 8px;
  object-fit: cover;
  display: block;
`;o("span")`
  position: absolute;
  right: -6px;
  top: -6px;
  display: flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
`;o("button")`
  position: absolute;
  right: -6px;
  top: -6px;
  display: none;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: ${e.secondary700};
  color: ${e.secondary200};
  border: none;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 0;
  &:hover {
    color: ${e.foreground};
  }
`;o("div")`
  display: flex;
  align-items: flex-end;
  gap: 8px;
`;o("button")`
  display: flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: none;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
  padding: 0;
  background: ${r=>r.$variant==="fg"?e.foreground:e.accent};
  color: ${r=>r.$variant==="fg"?e.popover:e.mutedForeground};
  cursor: ${r=>r.$variant==="disabled"?"default":"pointer"};
  &:hover {
    color: ${r=>r.$variant!=="disabled"?e.foreground:void 0};
  }
`;o("textarea")`
  flex: 1;
  min-width: 0;
  resize: none;
  border: none;
  background: transparent;
  padding: 4px 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 24px;
  color: ${e.foreground};
  outline: none;
  font-family: ${e.font};
  &::placeholder {
    color: ${e.mutedForeground};
  }
  &:disabled {
    opacity: 0.5;
  }
`;o("div")`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  border-radius: 12px;
  border: 1px solid ${e.border};
  background: ${e.secondary700};
  padding: 10px;
  font-family: ${e.font};
  box-sizing: border-box;
  * {
    box-sizing: border-box;
  }
`;o("div")`
  display: flex;
  height: 32px;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  background: white;
  padding-left: 10px;
  padding-right: 10px;
  font-size: 12px;
  font-weight: 500;
  color: ${e.secondary900};
`;o("div")`
  display: flex;
  align-items: center;
`;o("button")`
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: ${r=>r.$disabled?e.mutedForeground:e.secondary100};
  cursor: ${r=>r.$disabled?"default":"pointer"};
  transition: color 0.15s ease;
  padding: 0;
  &:hover {
    color: ${r=>r.$disabled?void 0:e.foreground};
  }
`;o("div")`
  display: flex;
  align-items: center;
  gap: 8px;
`;o("button")`
  display: flex;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid ${e.secondary500};
  background: rgba(0, 0, 0, 0.05);
  padding-left: 10px;
  padding-right: 10px;
  font-size: 12px;
  font-weight: 500;
  color: ${e.secondary200};
  cursor: pointer;
  font-family: ${e.font};
  transition: color 0.15s ease;
  &:hover {
    color: ${e.foreground};
  }
`;o("button")`
  display: flex;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  background: ${e.primary};
  padding-left: 10px;
  padding-right: 10px;
  font-size: 12px;
  font-weight: 500;
  color: ${e.primaryForeground};
  cursor: pointer;
  font-family: ${e.font};
  transition: background-color 0.15s ease;
  &:hover {
    background: color-mix(in oklab, ${e.primary} 85%, black);
  }
`;o("div")`
  border-radius: 12px;
  border: 1px solid ${e.border};
  background: ${e.secondary700};
  padding: 4px;
  font-family: ${e.font};
  box-sizing: border-box;
  max-height: 240px;
  overflow-y: auto;
  min-width: 260px;
  * {
    box-sizing: border-box;
  }
`;const s=o("button")`
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: ${e.mutedForeground};
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    color 0.12s ease,
    background 0.12s ease;
  &:hover {
    color: #f87171;
    background: rgba(248, 113, 113, 0.1);
  }
`;o("div")`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
  background: transparent;
  transition: background 0.12s ease;
  &:hover {
    background: ${e.secondary800};
  }
  &:hover ${s} {
    opacity: 1;
  }
`;o("div")`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${e.primary};
  color: ${e.primaryForeground};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
`;o("span")`
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: ${e.secondary200};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
