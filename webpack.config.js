const autoprefixer = require('autoprefixer');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const spawnSync = require('child_process').spawnSync;
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const fs = require('fs');
const path = require('path');

function readConfig() {
  const configPath = fs.existsSync('./config-local.json')
    ? './config-local.json'
    : './config.json';

  try {
    const config = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(config);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      `Could not load the required configuration file.\n` +
        'Please consult the project README.md for further information.'
    );

    throw e;
  }
}

function getConfig() {
  var config = readConfig();
  var pkg = require('./package.json');
  config.version = pkg.version;
  return config;
}

module.exports = () => {
  const isDevMode = process.env.NODE_ENV === 'development';
  const config = getConfig();
  const buildReference = (() => {
    try {
      const res = spawnSync('git', ['describe', '--always', '--dirty'], {
        encoding: 'utf8',
      });
      if (res && res.status === 0 && typeof res.stdout === 'string') {
        return res.stdout.trim();
      }
    } catch {
      // ignore; fall back to empty string
    }
    return '';
  })();

  return {
    context: __dirname + '/lib',
    mode: isDevMode ? 'development' : 'production',
    devtool:
      process.env.SOURCEMAP || (isDevMode && 'eval-cheap-module-source-map'),
    entry: ['./boot'],
    output: {
      filename: 'app.[fullhash].js',
      chunkFilename: '[name].[chunkhash].js',
      ...(config.is_app_engine && {
        publicPath: config.web_app_url + '/',
      }),
    },
    // target: 'browserslist', // this seems like it should be "node" or "electron-renderer" but those both crash
    module: {
      rules: [
        {
          test: /\.[jt]sx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'babel-loader',
            },
          ],
        },
        // Handle CSS imports with ?inline query (Vite-style) - export as raw string
        {
          test: /\.css$/,
          resourceQuery: /inline/,
          type: 'asset/source',
        },
        {
          test: /\.(sa|sc|c)ss$/,
          // Exclude CSS files with ?inline query (handled above)
          resourceQuery: { not: [/inline/] },
          use: [
            isDevMode ? 'style-loader' : MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader',
              options: {
                sourceMap: isDevMode,
              },
            },
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [autoprefixer()],
                },
                sourceMap: isDevMode,
              },
            },
            {
              loader: 'sass-loader',
              options: {
                api: 'modern-compiler',
                sassOptions: {
                  includePaths: [__dirname + '/lib'],
                },
                sourceMap: isDevMode,
              },
            },
          ],
        },
        {
          test: /\.ttf$/,
          type: 'asset/resource',
        },
        {
          test: /\.(woff2?|eot)$/,
          type: 'asset/resource',
        },
        {
          test: /\.(png|jpe?g|gif|svg|webp)$/i,
          type: 'asset/resource',
        },
      ],
    },
    resolve: {
      // Prefer TS/JS sources over CSS when resolving directory "index" files.
      // (Muya's source uses folders like `ui/baseFloat/index.ts` + `index.css`.)
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.scss', '.css'],
      modules: ['node_modules'],
      alias: {
        // Use the local vendored Muya source for full customization.
        '@muyajs/core': path.resolve(__dirname, 'lib/muya/packages/core/src'),
      },
    },
    plugins: [
      new NodePolyfillPlugin({
        includeAliases: [
          'Buffer',
          'buffer',
          'path',
          'process',
          'stream',
          'util',
        ],
      }),
      new HtmlWebpackPlugin({
        'build-platform': process.platform,
        'build-reference': buildReference,
        favicon: process.cwd() + '/resources/images/favicon.ico',
        'node-version': process.version,
        template: 'index.ejs',
        title: 'Recall',
      }),
      new MiniCssExtractPlugin({
        filename: isDevMode ? '[name].css' : '[name].[fullhash].css',
        chunkFilename: isDevMode ? '[id].css' : '[id].[fullhash].css',
      }),
      new webpack.DefinePlugin({
        __TEST__: JSON.stringify(process.env.NODE_ENV === 'test'),
        config: JSON.stringify(config),
      }),
      new webpack.IgnorePlugin({
        resourceRegExp: /^\.\/locale$/,
        contextRegExp: /moment$/,
      }),
      // Tell webpack about dynamic imports for Prism.js language components.
      // This ensures all prism-*.js files are available as lazy-loadable chunks.
      new webpack.ContextReplacementPlugin(
        /prismjs[\\/]components$/,
        /prism-[\w-]+\.js$/
      ),
    ],
  };
};
