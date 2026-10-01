// Shared builders for the F8 report tests: a valid spec and the bundle-fixture data. Synthetic only.
import type {ReportBlockSpec, ReportFilters, ReportSpec} from '../../src/chat/report-types';
import type {MetricData, MetricRequest} from '../../src/chat/result-types';
import {buildBundleFixture} from './bundle-fixture';
import {standardData} from './skill-eval-fixtures';

export const FILTERS: ReportFilters = {range: 'all_available', from: '', to: '', pet: 'all', event: 'all', channel: 'offline', pinned: false};

export const Q = {metric: 'bundle_sales', dimension: 'none', measure: 'default', compare_to: 'none', sort: 'default', limit: 25} as const;

export const kpiBlock = (id: string, over: Partial<ReportBlockSpec> = {}): ReportBlockSpec =>
  ({id, kind: 'kpi', query: {...Q}, view: {value: 'bundle_revenue', label: 'Bundle revenue', format: 'peso'}, ...over}) as ReportBlockSpec;
export const chartBlock = (id: string): ReportBlockSpec =>
  ({id, kind: 'chart', query: {...Q, dimension: 'pet_type'}, view: {kind: 'auto', orientation: 'auto', mode: 'auto', x: 'auto', y: ['auto'], title: 'Revenue by pet'}});
export const tableBlock = (id: string): ReportBlockSpec =>
  ({id, kind: 'table', query: {...Q, dimension: 'bundle_by_pet'}, view: {columns: ['auto'], title: 'By bundle'}});

export const spec = (blocks: ReportBlockSpec[] = [kpiBlock('b1'), chartBlock('b2'), tableBlock('b3')], over: Partial<ReportSpec> = {}): ReportSpec =>
  ({spec_version: 1, title: 'Bundle sales', filters: {...FILTERS}, blocks, ...over});

export const BASE: MetricRequest = {
  metric: 'bundle_sales', dimension: 'none', measure: 'default', range: 'all_available', from: '', to: '', channel: 'offline', event: 'all', pet: 'all',
  compare_to: 'none', sort: 'default', limit: 25,
};

export const fx = buildBundleFixture();
export const bundleData = (): MetricData => ({...standardData(), orders: fx.orders});
