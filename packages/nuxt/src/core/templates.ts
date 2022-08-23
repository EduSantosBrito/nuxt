import type { Nuxt, NuxtApp, NuxtTemplate } from '@nuxt/schema'
import { genArrayFromRaw, genDynamicImport, genExport, genImport, genObjectFromRawEntries, genString, genSafeVariableName } from 'knitwork'

import { isAbsolute, join, relative } from 'pathe'
import { resolveSchema, generateTypes } from 'untyped'
import escapeRE from 'escape-string-regexp'
import { hash } from 'ohash'
import { camelCase } from 'scule'

export interface TemplateContext {
  nuxt: Nuxt
  app: NuxtApp
}

export const vueShim: NuxtTemplate = {
  filename: 'types/vue-shim.d.ts',
  getContents: () =>
    [
      'declare module \'*.vue\' {',
      '  import { DefineComponent } from \'@vue/runtime-core\'',
      '  const component: DefineComponent<{}, {}, any>',
      '  export default component',
      '}'
    ].join('\n')
}

// TODO: Use an alias
export const appComponentTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'app-component.mjs',
  getContents: ctx => genExport(ctx.app.mainComponent!, ['default'])
}
// TODO: Use an alias
export const rootComponentTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'root-component.mjs',
  getContents: ctx => genExport(ctx.app.rootComponent!, ['default'])
}
// TODO: Use an alias
export const errorComponentTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'error-component.mjs',
  getContents: ctx => genExport(ctx.app.errorComponent!, ['default'])
}

export const cssTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'css.mjs',
  getContents: ctx => ctx.nuxt.options.css.map(i => genImport(i)).join('\n')
}

export const clientPluginTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'plugins/client.mjs',
  getContents (ctx) {
    const clientPlugins = ctx.app.plugins.filter(p => !p.mode || p.mode !== 'server')
    const exports: string[] = []
    const imports: string[] = []
    for (const plugin of clientPlugins) {
      const path = relative(ctx.nuxt.options.rootDir, plugin.src)
      const variable = genSafeVariableName(path).replace(/_(45|46|47)/g, '_') + '_' + hash(path)
      exports.push(variable)
      imports.push(genImport(plugin.src, variable))
    }
    return [
      ...imports,
      `export default ${genArrayFromRaw(exports)}`
    ].join('\n')
  }
}

export const serverPluginTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'plugins/server.mjs',
  getContents (ctx) {
    const serverPlugins = ctx.app.plugins.filter(p => !p.mode || p.mode !== 'client')
    const exports: string[] = ['preload']
    const imports: string[] = ["import preload from '#app/plugins/preload.server'"]
    for (const plugin of serverPlugins) {
      const path = relative(ctx.nuxt.options.rootDir, plugin.src)
      const variable = genSafeVariableName(path).replace(/_(45|46|47)/g, '_') + '_' + hash(path)
      exports.push(variable)
      imports.push(genImport(plugin.src, variable))
    }
    return [
      ...imports,
      `export default ${genArrayFromRaw(exports)}`
    ].join('\n')
  }
}

export const pluginsDeclaration: NuxtTemplate<TemplateContext> = {
  filename: 'types/plugins.d.ts',
  getContents: (ctx) => {
    const EXTENSION_RE = new RegExp(`(?<=\\w)(${ctx.nuxt.options.extensions.map(e => escapeRE(e)).join('|')})$`, 'g')
    const tsImports = ctx.app.plugins.map(p => (isAbsolute(p.src) ? relative(join(ctx.nuxt.options.buildDir, 'types'), p.src) : p.src).replace(EXTENSION_RE, ''))

    return `// Generated by Nuxt'
import type { Plugin } from '#app'

type Decorate<T extends Record<string, any>> = { [K in keyof T as K extends string ? \`$\${K}\` : never]: T[K] }

type InjectionType<A extends Plugin> = A extends Plugin<infer T> ? Decorate<T> : unknown

type NuxtAppInjections = \n  ${tsImports.map(p => `InjectionType<typeof ${genDynamicImport(p, { wrapper: false })}.default>`).join(' &\n  ')}

declare module '#app' {
  interface NuxtApp extends NuxtAppInjections { }
}

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties extends NuxtAppInjections { }
}

export { }
`
  }
}

const adHocModules = ['router', 'pages', 'imports', 'meta', 'components']
export const schemaTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'types/schema.d.ts',
  getContents: ({ nuxt }) => {
    const moduleInfo = nuxt.options._installedModules.map(m => ({
      ...m.meta || {},
      importName: m.entryPath || m.meta?.name
    })).filter(m => m.configKey && m.name && !adHocModules.includes(m.name))

    return [
      "import { NuxtModule } from '@nuxt/schema'",
      "declare module '@nuxt/schema' {",
      '  interface NuxtConfig {',
      ...moduleInfo.filter(Boolean).map(meta =>
        `    [${genString(meta.configKey)}]?: typeof ${genDynamicImport(meta.importName, { wrapper: false })}.default extends NuxtModule<infer O> ? Partial<O> : Record<string, any>`
      ),
      '  }',
      generateTypes(resolveSchema(Object.fromEntries(Object.entries(nuxt.options.runtimeConfig).filter(([key]) => key !== 'public'))),
        {
          interfaceName: 'RuntimeConfig',
          addExport: false,
          addDefaults: false,
          allowExtraKeys: false,
          indentation: 2
        }),
      generateTypes(resolveSchema(nuxt.options.runtimeConfig.public),
        {
          interfaceName: 'PublicRuntimeConfig',
          addExport: false,
          addDefaults: false,
          allowExtraKeys: false,
          indentation: 2
        }),
      '}'
    ].join('\n')
  }
}

// Add layouts template
export const layoutTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'layouts.mjs',
  getContents ({ app }) {
    const layoutsObject = genObjectFromRawEntries(Object.values(app.layouts).map(({ name, file }) => {
      return [name, `defineAsyncComponent(${genDynamicImport(file)})`]
    }))
    return [
      'import { defineAsyncComponent } from \'vue\'',
      `export default ${layoutsObject}`
    ].join('\n')
  }
}

// Add middleware template
export const middlewareTemplate: NuxtTemplate<TemplateContext> = {
  filename: 'middleware.mjs',
  getContents ({ app }) {
    const globalMiddleware = app.middleware.filter(mw => mw.global)
    const namedMiddleware = app.middleware.filter(mw => !mw.global)
    const namedMiddlewareObject = genObjectFromRawEntries(namedMiddleware.map(mw => [mw.name, genDynamicImport(mw.path)]))
    return [
      ...globalMiddleware.map(mw => genImport(mw.path, genSafeVariableName(mw.name))),
      `export const globalMiddleware = ${genArrayFromRaw(globalMiddleware.map(mw => genSafeVariableName(mw.name)))}`,
      `export const namedMiddleware = ${namedMiddlewareObject}`
    ].join('\n')
  }
}

export const clientConfigTemplate: NuxtTemplate = {
  filename: 'nitro.client.mjs',
  getContents: () => `
export const useRuntimeConfig = () => window?.__NUXT__?.config || {}
`
}

export const appConfigDeclarationTemplate: NuxtTemplate = {
  filename: 'types/app.config.d.ts',
  getContents: ({ app, nuxt }) => {
    return `
import type { Defu } from 'defu'
${app.configs.map((id: string, index: number) => `import ${`cfg${index}`} from ${JSON.stringify(id.replace(/(?<=\w)\.\w+$/g, ''))}`).join('\n')}

declare const inlineConfig = ${JSON.stringify(nuxt.options.appConfig, null, 2)}
type ResolvedAppConfig = Defu<typeof inlineConfig, [${app.configs.map((_id: string, index: number) => `typeof cfg${index}`).join(', ')}]>

declare module '@nuxt/schema' {
  interface AppConfig extends ResolvedAppConfig { }
}
`
  }
}

export const appConfigTemplate: NuxtTemplate = {
  filename: 'app.config.mjs',
  write: true,
  getContents: ({ app, nuxt }) => {
    return `
import defu from 'defu'

const inlineConfig = ${JSON.stringify(nuxt.options.appConfig, null, 2)}

${app.configs.map((id: string, index: number) => `import ${`cfg${index}`} from ${JSON.stringify(id)}`).join('\n')}
export default defu(${app.configs.map((_id: string, index: number) => `cfg${index}`).concat(['inlineConfig']).join(', ')})
`
  }
}

export const publicPathTemplate: NuxtTemplate = {
  filename: 'paths.mjs',
  getContents ({ nuxt }) {
    return [
      'import { joinURL } from \'ufo\'',
      !nuxt.options.dev && 'import { useRuntimeConfig } from \'#internal/nitro\'',

      nuxt.options.dev
        ? `const appConfig = ${JSON.stringify(nuxt.options.app)}`
        : 'const appConfig = useRuntimeConfig().app',

      'export const baseURL = () => appConfig.baseURL',
      'export const buildAssetsDir = () => appConfig.buildAssetsDir',

      'export const buildAssetsURL = (...path) => joinURL(publicAssetsURL(), buildAssetsDir(), ...path)',

      'export const publicAssetsURL = (...path) => {',
      '  const publicBase = appConfig.cdnURL || appConfig.baseURL',
      '  return path.length ? joinURL(publicBase, ...path) : publicBase',
      '}',

      'globalThis.__buildAssetsURL = buildAssetsURL',
      'globalThis.__publicAssetsURL = publicAssetsURL'
    ].filter(Boolean).join('\n')
  }
}

// Allow direct access to specific exposed nuxt.config
export const nuxtConfigTemplate = {
  filename: 'nuxt.config.mjs',
  getContents: (ctx: TemplateContext) => {
    return Object.entries(ctx.nuxt.options.app).map(([k, v]) => `export const ${camelCase('app-' + k)} = ${JSON.stringify(v)}`).join('\n\n')
  }
}
