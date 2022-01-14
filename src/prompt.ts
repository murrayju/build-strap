import { stdin as input, stdout as output } from 'process';
import readline from 'readline';

export const ask = async (question: string): Promise<string> => {
  // Once we move to Node 18+, can replace this with a builtin Promise interface
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(question, (value) => {
      rl.close();
      resolve(value.trim());
    });
  });
};

export const userQuestion = async (
  question: string,
  test: (input: string) => boolean | Promise<boolean> = (v) => !!v,
): Promise<string> => {
  let answer;
  do {
    answer = await ask(question);
  } while (!(await test(answer)));
  return answer;
};
