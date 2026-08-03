begin;
select plan(1);

select has_function('set_updated_at', 'existe la función set_updated_at');

select * from finish();
rollback;
