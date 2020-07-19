import path from 'path';

const paths = {
  root: path.resolve(__dirname, '../'),
  in: (...args) => path.join(...args),
};

// paths at the root
['src', 'out', 'dist'].forEach((n) => {
  paths[n] = path.join(paths.root, n);
});
paths.distSrc = path.join(paths.dist, 'src');

export default paths;
