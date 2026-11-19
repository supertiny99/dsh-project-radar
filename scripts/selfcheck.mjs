import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let entry;
const source = await readFile('dist/client.js', 'utf8');
new Function('window', source)({
	__ModuleLoader__: {
		load: (value) => {
			entry = value;
		},
	},
});
assert.equal(entry.id, '@supertiny99/dsh-project-radar');
const react = { createElement: () => null, Component: class {}, Fragment: 'fragment' };
const client = entry.factory((specifier) => {
	if (specifier === 'react') return react;
	if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {};
	throw new Error(`未声明的外部依赖 ${specifier}`);
});
assert.ok(client.inject.includes('slots'));
const registrations = [];
client.apply({
	slots: {
		inject: (name, callback) => callback(),
		register: (options, component) => {
			registrations.push({ options, component });
			return () => {};
		},
	},
});
assert.deepEqual(registrations.map((item) => item.options.name).sort(), [
	'main',
	'sidebar.panellist',
]);
assert.equal(
	registrations.find((item) => item.options.name === 'main').options.key,
	registrations.find((item) => item.options.name === 'sidebar.panellist').options.id
);
const meta = JSON.parse(await readFile('dist/meta.json', 'utf8'));
assert.ok(
	!Object.keys(meta.inputs).some(
		(path) => path.includes('node_modules/react/') || path.includes('node_modules/react-dom/')
	)
);
// UI 风格指南 §1：颜色零硬编码（不出现十六进制色值，全部走 --dsw-* token 或 rgb()/color-mix 派生）
const css = await readFile('src/style.css', 'utf8');
const hexColors = css.match(/#[0-9a-fA-F]{3,8}\b/g);
assert.equal(hexColors, null, `style.css 出现硬编码十六进制色值：${hexColors?.join(', ')}`);
console.log('selfcheck 通过，加载器、双插槽、React 单例、零硬编码色值检查完成');
