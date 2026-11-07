import moment from 'moment';

export const parseDockerDate = (date: string): Date =>
  moment(date, 'YYYY-MM-DD HH:mm:ss ZZ').toDate();
