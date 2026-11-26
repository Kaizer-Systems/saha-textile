import type { PluginCreator, Root } from 'postcss';

export declare const DARK_CLASS: string;
export declare function isDarkSelector(selector: string): boolean;
export declare function colourOf(shorthand: string): string | null;
export declare function withoutDarkRules(root: Root): number;
export declare function darkRulesOnly(css: string, report?: { kept: Map<string, number>; notColour: string[] }): string;
export declare const stripDarkRules: PluginCreator<{ only?: RegExp }>;
